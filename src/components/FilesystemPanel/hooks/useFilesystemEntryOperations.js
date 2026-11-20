import { invoke } from "@tauri-apps/api/core";
import { useCallback } from "react";
import {
  workspaceOpenFolderFromTab,
  workspaceOpenWorkspaceFolderFromTab,
} from "../../../workspace/workspaceApi";
import { getParentDirectoryPath, isSamePath } from "../../../utils/pathWatch";
import { pushRenameHistoryEntry } from "../operations/filesystemOperationHistory";
import { getNavigationErrorMessage } from "./filesystemNavigationUtils";

const DEFAULT_NEW_TEXT_FILE_NAME = "untitled.txt";
const DEFAULT_NEW_FOLDER_NAME = "New folder";

// Opening, renaming and creating run at once, also while the tab's operations run
// (useFilesystemQueuedOperations): a rename or a create uses the inline rename box and selects the
// new item, which would take over whatever the user does by then if it waited its turn.
export default function useFilesystemEntryOperations({
  tabId = "",
  tabWorkspaceRoot = "",
  paneKey,
  currentPath = "",
  clearSelection,
  refreshEntriesForPath,
  navigateToPath,
  setError,
}) {
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

  const renameEntry = useCallback(async (sourcePath, nextName) => {
    const normalizedSourcePath = typeof sourcePath === "string" ? sourcePath.trim() : "";
    const normalizedNextName = typeof nextName === "string" ? nextName.trim() : "";
    if (!normalizedSourcePath || !normalizedNextName) return null;

    const parentPath = getParentDirectoryPath(normalizedSourcePath);
    if (!parentPath) return null;

    setError("");

    try {
      const renameResult = await invoke("rename_path", {
        path: normalizedSourcePath,
        newName: normalizedNextName,
      });
      pushRenameHistoryEntry(paneKey, normalizedSourcePath, renameResult.path);

      await refreshEntriesForPath(parentPath);
      return renameResult;
    } catch (renameError) {
      setError(getNavigationErrorMessage(renameError, "Failed to rename item."));
      throw renameError;
    }
  }, [paneKey, refreshEntriesForPath, setError]);

  const createEntry = useCallback(async (
    command,
    parentDir,
    defaultName,
    createErrorMessage,
  ) => {
    const normalizedParentDir = typeof parentDir === "string" ? parentDir.trim() : "";
    const normalizedName = typeof defaultName === "string" ? defaultName.trim() : "";
    if (!normalizedParentDir || !normalizedName) return null;

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
    }
  }, [refreshEntriesForPath, setError]);

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

  return {
    openEntry,
    renameEntry,
    createTextFile,
    createFolder,
  };
}
