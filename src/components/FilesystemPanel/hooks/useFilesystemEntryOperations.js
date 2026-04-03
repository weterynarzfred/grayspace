import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef } from "react";
import {
  workspaceOpenFolderFromTab,
  workspaceOpenWorkspaceFolderFromTab,
} from "../../../workspace/workspaceApi";
import { uniqueNonEmptyPaths } from "../../../utils/pathSelection";
import { getParentDirectoryPath, isSamePath } from "../../../utils/pathWatch";
import { getNavigationErrorMessage } from "./filesystemNavigationUtils";

const MAX_FILESYSTEM_HISTORY_ITEMS = 100;

function getPathName(path) {
  if (typeof path !== "string") return "";
  const trimmedPath = path.trim().replace(/[\\/]+$/, "");
  if (!trimmedPath) return "";

  const separatorIndex = Math.max(
    trimmedPath.lastIndexOf("\\"),
    trimmedPath.lastIndexOf("/"),
  );
  return separatorIndex >= 0 ? trimmedPath.slice(separatorIndex + 1) : trimmedPath;
}

function joinPath(directoryPath, pathName) {
  if (typeof directoryPath !== "string" || typeof pathName !== "string") return "";
  const trimmedDirectoryPath = directoryPath.trim().replace(/[\\/]+$/, "");
  const trimmedPathName = pathName.trim();
  if (!trimmedDirectoryPath || !trimmedPathName) return "";

  if (trimmedDirectoryPath === "/") return `/${trimmedPathName}`;
  if (/^[A-Za-z]:$/.test(trimmedDirectoryPath)) return `${trimmedDirectoryPath}\\${trimmedPathName}`;

  const separator = trimmedDirectoryPath.includes("\\") ? "\\" : "/";
  return `${trimmedDirectoryPath}${separator}${trimmedPathName}`;
}

function resolveDestinationPath(sourcePath, destinationDir, movedResult) {
  if (typeof movedResult === "string" && movedResult.trim()) return movedResult;
  return joinPath(destinationDir, getPathName(sourcePath));
}

function normalizeMoveHistoryItems(items = []) {
  return items
    .filter(item =>
      typeof item?.sourcePath === "string"
      && item.sourcePath
      && typeof item?.destinationPath === "string"
      && item.destinationPath,
    )
    .map(item => ({
      sourcePath: item.sourcePath,
      destinationPath: item.destinationPath,
    }));
}

export default function useFilesystemEntryOperations({
  tabId = "",
  tabWorkspaceRoot = "",
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

  const pushMoveHistoryEntry = useCallback((items = []) => {
    const normalizedItems = normalizeMoveHistoryItems(items);
    if (normalizedItems.length === 0) return;

    undoStackRef.current.push({
      kind: "move",
      items: normalizedItems,
    });
    if (undoStackRef.current.length > MAX_FILESYSTEM_HISTORY_ITEMS) {
      undoStackRef.current.splice(
        0,
        undoStackRef.current.length - MAX_FILESYSTEM_HISTORY_ITEMS,
      );
    }
    redoStackRef.current = [];
  }, []);

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
      setError(getNavigationErrorMessage(moveError, errorMessage));
      moveErrorToThrow = moveError;
    } finally {
      if (activePath && movedItems.length > 0) {
        try {
          await refreshEntriesForPath(activePath);
        } catch (refreshError) {
          if (!moveErrorToThrow) {
            setError(getNavigationErrorMessage(refreshError, "Failed to refresh folder."));
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
  }, [
    currentPath,
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
      setError(getNavigationErrorMessage(copyError, "Failed to copy item."));
      copyErrorToThrow = copyError;
    } finally {
      if (activePath) {
        try {
          await refreshEntriesForPath(activePath);
        } catch (refreshError) {
          if (!copyErrorToThrow) {
            setError(getNavigationErrorMessage(refreshError, "Failed to refresh folder."));
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
      setError(getNavigationErrorMessage(importError, "Failed to import dropped items."));
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
  ]);

  const undoEntries = useCallback(async () => {
    const lastEntry = undoStackRef.current.at(-1);
    if (!lastEntry || lastEntry.kind !== "move") return false;

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
        activePath: currentPathRef.current || currentPath,
        removeSelection: false,
        errorMessage: "Failed to undo move.",
      });
      undoStackRef.current.pop();
      redoStackRef.current.push(lastEntry);
      return true;
    } catch (undoError) {
      console.error("[filesystem-undo] Failed to undo move operation.", undoError);
      return false;
    }
  }, [currentPath, currentPathRef, runMovePairs]);

  const redoEntries = useCallback(async () => {
    const lastEntry = redoStackRef.current.at(-1);
    if (!lastEntry || lastEntry.kind !== "move") return false;

    const redoPairs = lastEntry.items
      .map(item => ({
        sourcePath: item.sourcePath,
        destinationDir: getParentDirectoryPath(item.destinationPath),
      }))
      .filter(pair => pair.destinationDir);

    if (redoPairs.length === 0) return false;

    try {
      await runMovePairs(redoPairs, {
        activePath: currentPathRef.current || currentPath,
        removeSelection: false,
        errorMessage: "Failed to redo move.",
      });
      redoStackRef.current.pop();
      undoStackRef.current.push(lastEntry);
      return true;
    } catch (redoError) {
      console.error("[filesystem-redo] Failed to redo move operation.", redoError);
      return false;
    }
  }, [currentPath, currentPathRef, runMovePairs]);

  return {
    openEntry,
    moveEntries,
    copyEntries,
    deleteEntries,
    importExternalPaths,
    undoEntries,
    redoEntries,
  };
}
