import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef } from "react";
import {
  workspaceOpenFolderFromTab,
  workspaceOpenWorkspaceFolderFromTab,
} from "../../../workspace/workspaceApi";
import { uniqueNonEmptyPaths } from "../../../utils/pathSelection";
import { getParentDirectoryPath, isSamePath } from "../../../utils/pathWatch";
import { getNavigationErrorMessage } from "./filesystemNavigationUtils";
import {
  getPathName,
  normalizeMoveHistoryItems,
  resolveDestinationPath,
} from "./filesystemEntryOperationUtils";

const MAX_FILESYSTEM_HISTORY_ITEMS = 100;
const DEFAULT_NEW_TEXT_FILE_NAME = "untitled.txt";
const DEFAULT_NEW_FOLDER_NAME = "New folder";

export default function useFilesystemEntryOperations({
  tabId = "",
  tabWorkspaceRoot = "",
  pushNotification = undefined,
  currentPath = "",
  currentPathRef,
  clearSelection,
  removeSelectionPaths,
  refreshEntriesForPath,
  setCurrentPath,
  setError,
  setIsMovingEntry,
  setIsDeletingEntries,
  setIsImportingExternal,
}) {
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);

  const notifyUser = useCallback(({
    title = "Notice",
    message = "",
    tone = "info",
  } = {}) => {
    pushNotification?.({
      title,
      message,
      tone,
    });
  }, [pushNotification]);
  const notifyOperationError = useCallback(({
    title = "Operation failed",
    error = null,
    fallbackMessage = "Operation failed.",
  } = {}) => {
    const message = getNavigationErrorMessage(error, fallbackMessage);
    notifyUser({
      title,
      message,
      tone: "error",
    });
  }, [notifyUser]);

  const trimUndoStack = useCallback(() => {
    if (undoStackRef.current.length <= MAX_FILESYSTEM_HISTORY_ITEMS) return;
    undoStackRef.current.splice(
      0,
      undoStackRef.current.length - MAX_FILESYSTEM_HISTORY_ITEMS,
    );
  }, []);

  const pushHistoryEntry = useCallback((entry) => {
    undoStackRef.current.push(entry);
    trimUndoStack();
    redoStackRef.current = [];
  }, [trimUndoStack]);

  const pushMoveHistoryEntry = useCallback((items = []) => {
    const normalizedItems = normalizeMoveHistoryItems(items);
    if (normalizedItems.length === 0) return;
    pushHistoryEntry({
      kind: "move",
      items: normalizedItems,
    });
  }, [pushHistoryEntry]);

  const pushRenameHistoryEntry = useCallback((sourcePath = "", destinationPath = "") => {
    if (!sourcePath || !destinationPath || isSamePath(sourcePath, destinationPath)) return;
    pushHistoryEntry({
      kind: "rename",
      items: [{
        sourcePath,
        destinationPath,
      }],
    });
  }, [pushHistoryEntry]);

  const runMovePairs = useCallback(async (
    movePairs,
    {
      activePath = "",
      removeSelection = true,
      errorMessage = "Failed to move item.",
    } = {},
  ) => {
    const actionablePairs = movePairs.filter((pair) =>
      typeof pair?.sourcePath === "string"
      && pair.sourcePath
      && typeof pair?.destinationDir === "string"
      && pair.destinationDir
      && pair.sourcePath !== pair.destinationDir,
    );
    if (actionablePairs.length === 0) return [];

    const movedItems = [];
    let moveErrorToThrow = null;

    setIsMovingEntry(true);
    setError("");

    try {
      for (const pair of actionablePairs) {
        const movedResult = await invoke("move_path", {
          source: pair.sourcePath,
          destinationDir: pair.destinationDir,
        });
        movedItems.push({
          sourcePath: pair.sourcePath,
          destinationPath: resolveDestinationPath(
            pair.sourcePath,
            pair.destinationDir,
            movedResult,
          ),
        });
      }
    } catch (moveError) {
      moveErrorToThrow = moveError;
    } finally {
      if (activePath && movedItems.length > 0) {
        try {
          await refreshEntriesForPath(activePath);
        } catch (refreshError) {
          if (!moveErrorToThrow) {
            moveErrorToThrow = refreshError;
          }
        }
      }

      if (removeSelection && movedItems.length > 0) {
        removeSelectionPaths(new Set(movedItems.map(item => item.sourcePath)));
      }

      setIsMovingEntry(false);
    }

    if (moveErrorToThrow) throw moveErrorToThrow;
    return movedItems;
  }, [
    refreshEntriesForPath,
    removeSelectionPaths,
    setError,
    setIsMovingEntry,
  ]);

  const runRenameHistoryItems = useCallback(async (
    items = [],
    {
      reverse = false,
      activePath = "",
      errorMessage = "Failed to rename item.",
    } = {},
  ) => {
    const normalizedItems = normalizeMoveHistoryItems(items);
    if (normalizedItems.length === 0) return false;

    const operationItems = reverse
      ? normalizedItems.slice().reverse()
      : normalizedItems;
    const refreshPathSet = new Set();
    let renameErrorToThrow = null;

    setIsMovingEntry(true);
    setError("");

    try {
      for (const item of operationItems) {
        const sourcePath = reverse ? item.destinationPath : item.sourcePath;
        const destinationPath = reverse ? item.sourcePath : item.destinationPath;
        const destinationName = getPathName(destinationPath);
        if (!destinationName) continue;

        await invoke("rename_path", {
          path: sourcePath,
          newName: destinationName,
          allowAdjustment: false,
        });

        const sourceParentPath = getParentDirectoryPath(sourcePath);
        if (sourceParentPath) refreshPathSet.add(sourceParentPath);
        const destinationParentPath = getParentDirectoryPath(destinationPath);
        if (destinationParentPath) refreshPathSet.add(destinationParentPath);
      }
    } catch (renameError) {
      setError(getNavigationErrorMessage(renameError, errorMessage));
      renameErrorToThrow = renameError;
    } finally {
      if (activePath) refreshPathSet.add(activePath);

      for (const refreshPath of refreshPathSet) {
        if (!refreshPath) continue;
        try {
          await refreshEntriesForPath(refreshPath);
        } catch (refreshError) {
          if (!renameErrorToThrow) {
            setError(getNavigationErrorMessage(refreshError, "Failed to refresh folder."));
            renameErrorToThrow = refreshError;
          }
        }
      }

      setIsMovingEntry(false);
    }

    if (renameErrorToThrow) throw renameErrorToThrow;
    return true;
  }, [
    refreshEntriesForPath,
    setError,
    setIsMovingEntry,
  ]);

  const resolveWorkspaceRootForPath = useCallback(async (
    entryPath,
    isWorkspaceFolderHint = false,
  ) => {
    if (!entryPath) return "";
    if (isWorkspaceFolderHint) return entryPath;

    const visitedPaths = new Set();
    let candidatePath = entryPath;

    while (candidatePath && !visitedPaths.has(candidatePath)) {
      visitedPaths.add(candidatePath);

      try {
        const workspaceResult = await invoke("filesystem_resolve_workspace_folders", {
          paths: [candidatePath],
        });
        if (workspaceResult?.[candidatePath] === true) return candidatePath;
      } catch {
        return "";
      }

      try {
        const parentPath = await invoke("parent_path", { path: candidatePath });
        if (typeof parentPath !== "string" || !parentPath || parentPath === candidatePath) break;
        candidatePath = parentPath;
      } catch {
        break;
      }
    }

    return "";
  }, []);

  const openEntry = useCallback(async (entry, options = {}) => {
    if (entry.is_dir) {
      const workspaceRootForEntry = await resolveWorkspaceRootForPath(
        entry.path,
        options?.isWorkspaceFolder === true,
      );
      const shouldOpenInWorkspaceContext = Boolean(
        tabId
        && tabWorkspaceRoot
        && workspaceRootForEntry
        && isSamePath(workspaceRootForEntry, tabWorkspaceRoot),
      );
      const shouldOpenInNewTab = Boolean(tabId && (
        options?.forceOpenInNewTab
        || (workspaceRootForEntry && !shouldOpenInWorkspaceContext)
      ));

      if (shouldOpenInNewTab) {
        try {
          if (workspaceRootForEntry && isSamePath(workspaceRootForEntry, entry.path)) {
            await workspaceOpenWorkspaceFolderFromTab(tabId, entry.path);
          } else {
            await workspaceOpenFolderFromTab(tabId, entry.path);
          }
          clearSelection();
          setError("");
        } catch (openInNewTabError) {
          setError(getNavigationErrorMessage(openInNewTabError, "Failed to open folder in new tab."));
        }
        return;
      }

      setCurrentPath(entry.path);
      clearSelection();
      setError("");
      return;
    }

    try {
      await invoke("open_path", { path: entry.path });
    } catch (openError) {
      setError(getNavigationErrorMessage(openError, "Failed to open file."));
    }
  }, [clearSelection, resolveWorkspaceRootForPath, setCurrentPath, setError, tabId, tabWorkspaceRoot]);

  const moveEntries = useCallback(async (sourcePaths, destinationDir) => {
    const normalizedSourcePaths = uniqueNonEmptyPaths(sourcePaths);
    if (!destinationDir || normalizedSourcePaths.length === 0) return;

    const activePath = currentPath || destinationDir;
    try {
      const movedItems = await runMovePairs(
        normalizedSourcePaths.map(sourcePath => ({
          sourcePath,
          destinationDir,
        })),
        {
          activePath,
          removeSelection: true,
          errorMessage: "Failed to move item.",
        },
      );
      pushMoveHistoryEntry(movedItems);
      return movedItems;
    } catch (moveError) {
      notifyOperationError({
        title: "Move failed",
        error: moveError,
        fallbackMessage: "Failed to move item.",
      });
      throw moveError;
    }
  }, [
    currentPath,
    notifyOperationError,
    pushMoveHistoryEntry,
    runMovePairs,
  ]);

  const copyEntries = useCallback(async (sourcePaths, destinationDir) => {
    const normalizedSourcePaths = uniqueNonEmptyPaths(sourcePaths);
    if (!destinationDir || normalizedSourcePaths.length === 0) return;

    const activePath = currentPath;
    let copyErrorToThrow = null;

    setIsMovingEntry(true);
    setError("");

    try {
      await invoke("import_paths", { paths: normalizedSourcePaths, destinationDir });
    } catch (copyError) {
      notifyOperationError({
        title: "Copy failed",
        error: copyError,
        fallbackMessage: "Failed to copy item.",
      });
      copyErrorToThrow = copyError;
    } finally {
      if (activePath) {
        try {
          await refreshEntriesForPath(activePath);
        } catch (refreshError) {
          if (!copyErrorToThrow) {
            copyErrorToThrow = refreshError;
          }
        }
      }

      setIsMovingEntry(false);
    }

    if (copyErrorToThrow) throw copyErrorToThrow;
  }, [
    currentPath,
    refreshEntriesForPath,
    setError,
    setIsMovingEntry,
    notifyOperationError,
  ]);

  const deleteEntries = useCallback(async (paths) => {
    const normalizedPaths = uniqueNonEmptyPaths(paths);
    if (!currentPath || normalizedPaths.length === 0) return;

    const activePath = currentPath;
    const deletedPathSet = new Set(normalizedPaths);

    setIsDeletingEntries(true);
    setError("");

    try {
      await invoke("delete_paths", { paths: normalizedPaths });

      await refreshEntriesForPath(activePath);
      if (currentPathRef.current === activePath) {
        removeSelectionPaths(deletedPathSet);
      }
    } catch (deleteError) {
      setError(getNavigationErrorMessage(deleteError, "Failed to delete item."));
      throw deleteError;
    } finally {
      setIsDeletingEntries(false);
    }
  }, [
    currentPath,
    currentPathRef,
    refreshEntriesForPath,
    removeSelectionPaths,
    setError,
    setIsDeletingEntries,
  ]);

  const importExternalPaths = useCallback(async (paths, destinationDir = "") => {
    const normalizedDestinationDir = destinationDir || currentPath;
    if (!normalizedDestinationDir || !Array.isArray(paths) || paths.length === 0) return;

    const activePath = currentPath;

    setIsImportingExternal(true);
    setError("");

    try {
      await invoke("import_paths", { paths, destinationDir: normalizedDestinationDir });

      await refreshEntriesForPath(activePath);
      if (currentPathRef.current === activePath) {
        clearSelection();
      }
    } catch (importError) {
      notifyOperationError({
        title: "Import failed",
        error: importError,
        fallbackMessage: "Failed to import dropped items.",
      });
      throw importError;
    } finally {
      setIsImportingExternal(false);
    }
  }, [
    clearSelection,
    currentPath,
    currentPathRef,
    refreshEntriesForPath,
    setError,
    setIsImportingExternal,
    notifyOperationError,
  ]);

  const renameEntry = useCallback(async (sourcePath, nextName) => {
    const normalizedSourcePath = typeof sourcePath === "string" ? sourcePath.trim() : "";
    const normalizedNextName = typeof nextName === "string" ? nextName.trim() : "";
    if (!normalizedSourcePath || !normalizedNextName) return null;

    const parentPath = getParentDirectoryPath(normalizedSourcePath);
    if (!parentPath) return null;

    setIsMovingEntry(true);
    setError("");

    try {
      const renameResult = await invoke("rename_path", {
        path: normalizedSourcePath,
        newName: normalizedNextName,
      });

      if (!isSamePath(renameResult.path, normalizedSourcePath)) {
        pushRenameHistoryEntry(normalizedSourcePath, renameResult.path);
      }

      await refreshEntriesForPath(parentPath);
      return renameResult;
    } catch (renameError) {
      setError(getNavigationErrorMessage(renameError, "Failed to rename item."));
      throw renameError;
    } finally {
      setIsMovingEntry(false);
    }
  }, [
    pushRenameHistoryEntry,
    refreshEntriesForPath,
    setError,
    setIsMovingEntry,
  ]);

  const createEntry = useCallback(async (
    command,
    parentDir,
    defaultName,
    createErrorMessage,
  ) => {
    const normalizedParentDir = typeof parentDir === "string" ? parentDir.trim() : "";
    const normalizedName = typeof defaultName === "string" ? defaultName.trim() : "";
    if (!normalizedParentDir || !normalizedName) return null;

    setIsMovingEntry(true);
    setError("");

    try {
      const createResult = await invoke(command, {
        parentDir: normalizedParentDir,
        name: normalizedName,
      });
      await refreshEntriesForPath(normalizedParentDir);
      return createResult;
    } catch (createError) {
      setError(getNavigationErrorMessage(createError, createErrorMessage));
      throw createError;
    } finally {
      setIsMovingEntry(false);
    }
  }, [refreshEntriesForPath, setError, setIsMovingEntry]);

  const createTextFile = useCallback(async (parentDir = currentPath) => (
    createEntry(
      "create_text_file",
      parentDir,
      DEFAULT_NEW_TEXT_FILE_NAME,
      "Failed to create text file.",
    )
  ), [createEntry, currentPath]);

  const createFolder = useCallback(async (parentDir = currentPath) => (
    createEntry(
      "create_folder",
      parentDir,
      DEFAULT_NEW_FOLDER_NAME,
      "Failed to create folder.",
    )
  ), [createEntry, currentPath]);

  const undoEntries = useCallback(async () => {
    const lastEntry = undoStackRef.current.at(-1);
    if (!lastEntry) return false;

    const activePath = currentPathRef.current || currentPath;

    if (lastEntry.kind === "move") {
      const undoPairs = lastEntry.items
        .slice()
        .reverse()
        .map((item) => ({
          sourcePath: item.destinationPath,
          destinationDir: getParentDirectoryPath(item.sourcePath),
        }))
        .filter(pair => pair.destinationDir);
      if (undoPairs.length === 0) return false;

      try {
        await runMovePairs(undoPairs, {
          activePath,
          removeSelection: false,
          errorMessage: "Failed to undo move.",
        });
        undoStackRef.current.pop();
        redoStackRef.current.push(lastEntry);
        return true;
      } catch (undoError) {
        notifyUser({
          title: "Undo failed",
          message: getNavigationErrorMessage(undoError, "Failed to undo move."),
          tone: "error",
        });
        return false;
      }
    }

    if (lastEntry.kind === "rename") {
      try {
        await runRenameHistoryItems(lastEntry.items, {
          reverse: true,
          activePath,
          errorMessage: "Failed to undo rename.",
        });
        undoStackRef.current.pop();
        redoStackRef.current.push(lastEntry);
        return true;
      } catch (undoError) {
        notifyUser({
          title: "Undo failed",
          message: getNavigationErrorMessage(undoError, "Failed to undo rename."),
          tone: "error",
        });
        return false;
      }
    }

    return false;
  }, [currentPath, currentPathRef, notifyUser, runMovePairs, runRenameHistoryItems]);

  const redoEntries = useCallback(async () => {
    const lastEntry = redoStackRef.current.at(-1);
    if (!lastEntry) return false;

    const activePath = currentPathRef.current || currentPath;

    if (lastEntry.kind === "move") {
      const redoPairs = lastEntry.items
        .map(item => ({
          sourcePath: item.sourcePath,
          destinationDir: getParentDirectoryPath(item.destinationPath),
        }))
        .filter(pair => pair.destinationDir);
      if (redoPairs.length === 0) return false;

      try {
        await runMovePairs(redoPairs, {
          activePath,
          removeSelection: false,
          errorMessage: "Failed to redo move.",
        });
        redoStackRef.current.pop();
        undoStackRef.current.push(lastEntry);
        return true;
      } catch (redoError) {
        notifyUser({
          title: "Redo failed",
          message: getNavigationErrorMessage(redoError, "Failed to redo move."),
          tone: "error",
        });
        return false;
      }
    }

    if (lastEntry.kind === "rename") {
      try {
        await runRenameHistoryItems(lastEntry.items, {
          reverse: false,
          activePath,
          errorMessage: "Failed to redo rename.",
        });
        redoStackRef.current.pop();
        undoStackRef.current.push(lastEntry);
        return true;
      } catch (redoError) {
        notifyUser({
          title: "Redo failed",
          message: getNavigationErrorMessage(redoError, "Failed to redo rename."),
          tone: "error",
        });
        return false;
      }
    }

    return false;
  }, [currentPath, currentPathRef, notifyUser, runMovePairs, runRenameHistoryItems]);

  return {
    openEntry,
    moveEntries,
    copyEntries,
    deleteEntries,
    importExternalPaths,
    renameEntry,
    createTextFile,
    createFolder,
    undoEntries,
    redoEntries,
  };
}
