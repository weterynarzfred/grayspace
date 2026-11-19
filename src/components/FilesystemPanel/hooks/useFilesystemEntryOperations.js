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

async function renameHistoryItem(item, reverse, pathsToRefresh) {
  const sourcePath = reverse ? item.destinationPath : item.sourcePath;
  const destinationPath = reverse ? item.sourcePath : item.destinationPath;
  const destinationName = getPathName(destinationPath);
  if (!destinationName) return;

  await invoke("rename_path", {
    path: sourcePath,
    newName: destinationName,
    allowAdjustment: false,
  });

  const sourceParentPath = getParentDirectoryPath(sourcePath);
  if (sourceParentPath) pathsToRefresh.add(sourceParentPath);
  const destinationParentPath = getParentDirectoryPath(destinationPath);
  if (destinationParentPath) pathsToRefresh.add(destinationParentPath);
}

async function refreshPaths(pathSet, refreshEntriesForPath, setError) {
  let firstError = null;
  for (const refreshPath of pathSet) {
    if (!refreshPath) continue;
    try {
      await refreshEntriesForPath(refreshPath);
    } catch (refreshError) {
      if (!firstError) {
        setError(getNavigationErrorMessage(refreshError, "Failed to refresh folder."));
        firstError = refreshError;
      }
    }
  }
  return firstError;
}

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
  navigateToPath,
  setError,
  setIsMovingEntry,
  setIsDeletingEntries,
  setIsImportingExternal,
  beginTransfer,
  advanceTransfer,
  endTransfer,
  resolveConflicts,
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

  const pushMoveHistoryEntry = useCallback(({ movedItems, removedFolders }) => {
    const normalizedItems = normalizeMoveHistoryItems(movedItems);
    // A merge of empty folders into existing ones moves no items but removes the source folders.
    if (normalizedItems.length === 0 && removedFolders.length === 0) return;
    pushHistoryEntry({
      kind: "move",
      items: normalizedItems,
      removedFolders,
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

  // Resolves with what moved, for the history, and with the error that stopped it part way, if
  // any: a merge into an existing folder lists the items it moved inside it (also when it stopped
  // part way) and the source folders it removed. Undo recreates such folders before moving the
  // items back and redo removes them again after, both while the pane is busy.
  const runMovePairs = useCallback(async (
    movePairs,
    {
      activePath = "",
      removeSelection = true,
      conflictPolicy = "fail",
      recreateFolders = [],
      removeEmptyFolders = [],
    } = {},
  ) => {
    const actionablePairs = movePairs.filter((pair) =>
      typeof pair?.sourcePath === "string"
      && pair.sourcePath
      && typeof pair?.destinationDir === "string"
      && pair.destinationDir
      && pair.sourcePath !== pair.destinationDir,
    );
    const changesFolders = recreateFolders.length > 0 || removeEmptyFolders.length > 0;
    if (actionablePairs.length === 0 && !changesFolders) return { movedItems: [], removedFolders: [], error: null };

    const movedSourcePaths = [];
    const movedItems = [];
    const removedFolders = [];
    let error = null;

    setIsMovingEntry(true);
    setError("");
    const transfer = beginTransfer("move", actionablePairs.length);

    try {
      if (recreateFolders.length > 0) await invoke("recreate_folders", { paths: recreateFolders });
      for (const pair of actionablePairs) {
        if (transfer.cancelRequested) break;
        const moveResult = await invoke("move_path", {
          source: pair.sourcePath,
          destinationDir: pair.destinationDir,
          targetName: pair.targetName,
          jobId: transfer.jobId,
          conflictPolicy,
        });
        if (moveResult.merge) {
          // One by one: spreading a record of 100k+ items into push() overflows the call stack.
          for (const item of moveResult.merge.movedItems) movedItems.push(item);
          for (const folder of moveResult.merge.removedFolders) removedFolders.push(folder);
        } else {
          movedItems.push({
            sourcePath: pair.sourcePath,
            destinationPath: resolveDestinationPath(
              pair.sourcePath,
              pair.destinationDir,
              moveResult.destination,
            ),
          });
        }
        movedSourcePaths.push(pair.sourcePath);
        advanceTransfer(movedSourcePaths.length);
        // A merge that failed part way reports what it moved until then, recorded above.
        if (moveResult.error) throw moveResult.error;
      }
      if (removeEmptyFolders.length > 0) await invoke("remove_empty_folders", { paths: removeEmptyFolders });
    } catch (moveError) {
      if (!transfer.cancelRequested) error = moveError;
    } finally {
      endTransfer();
      if (activePath && (movedSourcePaths.length > 0 || changesFolders)) {
        try {
          await refreshEntriesForPath(activePath);
        } catch (refreshError) {
          error = error || refreshError;
        }
      }

      if (removeSelection && movedSourcePaths.length > 0) {
        removeSelectionPaths(new Set(movedSourcePaths));
      }

      setIsMovingEntry(false);
    }

    return { movedItems, removedFolders, error };
  }, [
    advanceTransfer,
    beginTransfer,
    endTransfer,
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
    const pathsToRefresh = new Set();
    let renameErrorToThrow = null;

    setIsMovingEntry(true);
    setError("");

    try {
      for (const item of operationItems) {
        await renameHistoryItem(item, reverse, pathsToRefresh);
      }
    } catch (renameError) {
      setError(getNavigationErrorMessage(renameError, errorMessage));
      renameErrorToThrow = renameError;
    } finally {
      if (activePath) pathsToRefresh.add(activePath);

      const refreshError = await refreshPaths(pathsToRefresh, refreshEntriesForPath, setError);
      if (refreshError && !renameErrorToThrow) renameErrorToThrow = refreshError;

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
          const openInTab = (workspaceRootForEntry && isSamePath(workspaceRootForEntry, entry.path))
            ? workspaceOpenWorkspaceFolderFromTab
            : workspaceOpenFolderFromTab;
          await openInTab(tabId, entry.path);
          clearSelection();
          setError("");
        } catch (openInNewTabError) {
          setError(getNavigationErrorMessage(openInNewTabError, "Failed to open folder in new tab."));
        }
        return;
      }

      navigateToPath(entry.path);
      return;
    }

    try {
      await invoke("open_path", { path: entry.path });
    } catch (openError) {
      setError(getNavigationErrorMessage(openError, "Failed to open file."));
    }
  }, [clearSelection, navigateToPath, resolveWorkspaceRootForPath, setError, tabId, tabWorkspaceRoot]);

  const moveEntries = useCallback(async (sourcePaths, destinationDir) => {
    const normalizedSourcePaths = uniqueNonEmptyPaths(sourcePaths);
    if (!destinationDir || normalizedSourcePaths.length === 0) return;

    const activePath = currentPath || destinationDir;
    try {
      const resolved = await resolveConflicts(normalizedSourcePaths, destinationDir);
      if (!resolved) return [];
      const moved = await runMovePairs(
        resolved.sourcePaths.map(sourcePath => ({
          sourcePath,
          destinationDir,
        })),
        {
          activePath,
          removeSelection: true,
          conflictPolicy: resolved.conflictPolicy,
        },
      );
      // What moved before an error can be undone too.
      pushMoveHistoryEntry(moved);
      if (moved.error) throw moved.error;
      return moved.movedItems;
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
    resolveConflicts,
    runMovePairs,
  ]);

  const copyEntries = useCallback(async (sourcePaths, destinationDir) => {
    const normalizedSourcePaths = uniqueNonEmptyPaths(sourcePaths);
    if (!destinationDir || normalizedSourcePaths.length === 0) return;

    const activePath = currentPath;
    let copyErrorToThrow = null;

    const resolved = await resolveConflicts(normalizedSourcePaths, destinationDir);
    if (!resolved || resolved.sourcePaths.length === 0) return;

    setIsMovingEntry(true);
    setError("");
    const transfer = beginTransfer("copy", resolved.sourcePaths.length);

    try {
      await invoke("import_paths", {
        paths: resolved.sourcePaths,
        destinationDir,
        jobId: transfer.jobId,
        conflictPolicy: resolved.conflictPolicy,
      });
    } catch (copyError) {
      if (!transfer.cancelRequested) {
        notifyOperationError({
          title: "Copy failed",
          error: copyError,
          fallbackMessage: "Failed to copy item.",
        });
        copyErrorToThrow = copyError;
      }
    } finally {
      endTransfer();
      if (activePath) {
        try {
          await refreshEntriesForPath(activePath);
        } catch (refreshError) {
          copyErrorToThrow = copyErrorToThrow || refreshError;
        }
      }

      setIsMovingEntry(false);
    }

    if (copyErrorToThrow) throw copyErrorToThrow;
  }, [
    beginTransfer,
    currentPath,
    endTransfer,
    refreshEntriesForPath,
    resolveConflicts,
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

    const resolved = await resolveConflicts(paths, normalizedDestinationDir);
    if (!resolved || resolved.sourcePaths.length === 0) return;

    setIsImportingExternal(true);
    setError("");
    const transfer = beginTransfer("copy", resolved.sourcePaths.length);

    try {
      await invoke("import_paths", {
        paths: resolved.sourcePaths,
        destinationDir: normalizedDestinationDir,
        jobId: transfer.jobId,
        conflictPolicy: resolved.conflictPolicy,
      });
    } catch (importError) {
      if (!transfer.cancelRequested) {
        notifyOperationError({
          title: "Import failed",
          error: importError,
          fallbackMessage: "Failed to import dropped items.",
        });
        throw importError;
      }
    } finally {
      endTransfer();
      setIsImportingExternal(false);
    }

    await refreshEntriesForPath(activePath);
    if (currentPathRef.current === activePath) {
      clearSelection();
    }
  }, [
    beginTransfer,
    clearSelection,
    currentPath,
    currentPathRef,
    endTransfer,
    refreshEntriesForPath,
    resolveConflicts,
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
      const { items } = lastEntry;
      const undoPairs = items
        .slice()
        .reverse()
        .map((item) => ({
          sourcePath: item.destinationPath,
          destinationDir: getParentDirectoryPath(item.sourcePath),
          // Back under its own name, which Keep both may have changed.
          targetName: getPathName(item.sourcePath),
        }))
        .filter(pair => pair.destinationDir);

      const { movedItems, error } = await runMovePairs(undoPairs, {
        activePath,
        removeSelection: false,
        errorMessage: "Failed to undo move.",
        // A merge removed the source folders it emptied; the items go back into them.
        recreateFolders: lastEntry.removedFolders,
      });
      // A cancel or error part way leaves the items it did not move back on the undo stack. Both
      // parts keep the removed folders: recreating one that is there does nothing, and redo
      // removes only empty ones.
      const notUndone = items.slice(0, items.length - movedItems.length);
      const undone = items.slice(items.length - movedItems.length);
      undoStackRef.current.pop();
      if (notUndone.length > 0) undoStackRef.current.push({ ...lastEntry, items: notUndone });
      if (undone.length > 0) redoStackRef.current.push({ ...lastEntry, items: undone });
      // A merge that only removed folders has no items: it is undone once they are back.
      if (items.length === 0 && error) undoStackRef.current.push(lastEntry);
      if (items.length === 0 && !error) redoStackRef.current.push(lastEntry);
      if (!error) return true;

      notifyUser({
        title: "Undo failed",
        message: getNavigationErrorMessage(error, "Failed to undo move."),
        tone: "error",
      });
      return false;
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
      const { items } = lastEntry;
      const redoPairs = items
        .map(item => ({
          sourcePath: item.sourcePath,
          destinationDir: getParentDirectoryPath(item.destinationPath),
          targetName: getPathName(item.destinationPath),
        }))
        .filter(pair => pair.destinationDir);

      const { movedItems, error } = await runMovePairs(redoPairs, {
        activePath,
        removeSelection: false,
        errorMessage: "Failed to redo move.",
        // As the merge did, leaves no emptied source folders behind.
        removeEmptyFolders: lastEntry.removedFolders,
      });
      // Split as in undo: the items a cancel or error left stay on the redo stack.
      const redone = items.slice(0, movedItems.length);
      const notRedone = items.slice(movedItems.length);
      redoStackRef.current.pop();
      if (notRedone.length > 0) redoStackRef.current.push({ ...lastEntry, items: notRedone });
      if (redone.length > 0) undoStackRef.current.push({ ...lastEntry, items: redone });
      if (items.length === 0 && error) redoStackRef.current.push(lastEntry);
      if (items.length === 0 && !error) undoStackRef.current.push(lastEntry);
      if (!error) return true;

      notifyUser({
        title: "Redo failed",
        message: getNavigationErrorMessage(error, "Failed to redo move."),
        tone: "error",
      });
      return false;
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
