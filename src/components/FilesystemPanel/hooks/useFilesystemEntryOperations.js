import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import {
  workspaceOpenFolderFromTab,
  workspaceOpenWorkspaceFolderFromTab,
} from "../../../workspace/workspaceApi";
import { uniqueNonEmptyPaths } from "../../../utils/pathSelection";
import { getNavigationErrorMessage } from "./filesystemNavigationUtils";

export default function useFilesystemEntryOperations({
  tabId = "",
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
  const resolveIsWorkspaceFolder = useCallback(async (entryPath, isWorkspaceFolderHint = false) => {
    if (!entryPath) return false;
    if (isWorkspaceFolderHint) return true;

    try {
      const workspaceResult = await invoke("filesystem_resolve_workspace_folders", {
        paths: [entryPath],
      });
      return workspaceResult?.[entryPath] === true;
    } catch {
      return false;
    }
  }, []);

  const openEntry = useCallback(async (entry, options = {}) => {
    if (entry.is_dir) {
      const shouldOpenAsWorkspace = await resolveIsWorkspaceFolder(
        entry.path,
        options?.isWorkspaceFolder === true,
      );
      const shouldOpenInNewTab = Boolean(options?.forceOpenInNewTab && tabId);

      if (shouldOpenInNewTab) {
        try {
          if (shouldOpenAsWorkspace) {
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

      if (shouldOpenAsWorkspace && tabId) {
        try {
          await workspaceOpenWorkspaceFolderFromTab(tabId, entry.path);
          clearSelection();
          setError("");
        } catch (workspaceOpenError) {
          setError(getNavigationErrorMessage(workspaceOpenError, "Failed to open workspace."));
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
  }, [clearSelection, resolveIsWorkspaceFolder, setCurrentPath, setError, tabId]);

  const moveEntries = useCallback(async (sourcePaths, destinationDir) => {
    const normalizedSourcePaths = uniqueNonEmptyPaths(sourcePaths);
    if (!destinationDir || normalizedSourcePaths.length === 0) return;

    const activePath = currentPath;
    const movedPaths = [];
    let moveErrorToThrow = null;

    setIsMovingEntry(true);
    setError("");

    try {
      for (const sourcePath of normalizedSourcePaths) {
        if (!sourcePath || sourcePath === destinationDir) continue;
        await invoke("move_path", { source: sourcePath, destinationDir });
        movedPaths.push(sourcePath);
      }
    } catch (moveError) {
      setError(getNavigationErrorMessage(moveError, "Failed to move item."));
      moveErrorToThrow = moveError;
    } finally {
      if (activePath && movedPaths.length > 0) {
        try {
          await refreshEntriesForPath(activePath);
        } catch (refreshError) {
          if (!moveErrorToThrow) {
            setError(getNavigationErrorMessage(refreshError, "Failed to refresh folder."));
            moveErrorToThrow = refreshError;
          }
        }
      }

      if (movedPaths.length > 0) {
        removeSelectionPaths(new Set(movedPaths));
      }

      setIsMovingEntry(false);
    }

    if (moveErrorToThrow) throw moveErrorToThrow;
  }, [
    currentPath,
    refreshEntriesForPath,
    removeSelectionPaths,
    setError,
    setIsMovingEntry,
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

  const importExternalPaths = useCallback(async (paths) => {
    if (!currentPath || !Array.isArray(paths) || paths.length === 0) return;

    const activePath = currentPath;

    setIsImportingExternal(true);
    setError("");

    try {
      await invoke("import_paths", { paths, destinationDir: activePath });

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

  return {
    openEntry,
    moveEntries,
    copyEntries,
    deleteEntries,
    importExternalPaths,
  };
}
