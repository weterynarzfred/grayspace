import { useCallback, useRef, useState } from "react";
import { normalizeInitialFilesystemState } from "./filesystemNavigationUtils";
import useFilesystemBrowsingState from "./useFilesystemBrowsingState";
import useFilesystemEntryOperations from "./useFilesystemEntryOperations";
import useFilesystemSelectionState from "./useFilesystemSelectionState";

export default function useFilesystemNavigation(
  initialFilesystemState = undefined,
  options = {},
) {
  const { tabId = "", tabWorkspaceRoot = "", pushNotification = undefined } = options;
  const initialStateRef = useRef(
    normalizeInitialFilesystemState(initialFilesystemState),
  );

  const {
    selectedPaths,
    clearSelection,
    keepSelectionOnlyInPathSet,
    removeSelectionPaths,
    setSelectedPath,
    selectEntry: selectEntryState,
  } = useFilesystemSelectionState({
    initialSelectedPaths: initialStateRef.current.selectedPaths,
    initialSelectionAnchorPath: initialStateRef.current.selectionAnchorPath,
  });

  const {
    drives,
    currentDrive,
    currentPath,
    currentPathRef,
    entries,
    isLoadingDrives,
    isLoadingEntries,
    isLoadingMoreEntries,
    hasMoreEntries,
    totalEntriesCount,
    error,
    canGoBack,
    canGoForward,
    setError,
    navigateToPath,
    selectDrive,
    goUp,
    goBack,
    goForward,
    refreshEntriesForPath,
    loadMoreEntries,
  } = useFilesystemBrowsingState({
    initialCurrentDrive: initialStateRef.current.currentDrive,
    initialCurrentPath: initialStateRef.current.currentPath,
    clearSelection,
    keepSelectionOnlyInPathSet,
  });

  const [isMovingEntry, setIsMovingEntry] = useState(false);
  const [isDeletingEntries, setIsDeletingEntries] = useState(false);
  const [isImportingExternal, setIsImportingExternal] = useState(false);

  const selectEntry = useCallback((entryPath, options = {}) => {
    const entryPaths = Array.isArray(options.entryPaths) && options.entryPaths.length > 0
      ? options.entryPaths
      : entries.map(entry => entry.path);
    return selectEntryState(
      entryPath,
      entryPaths,
      selectedPaths.filter(path => entryPaths.includes(path)),
      options,
    );
  }, [entries, selectEntryState, selectedPaths]);

  const {
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
  } = useFilesystemEntryOperations({
    tabId,
    tabWorkspaceRoot,
    pushNotification,
    currentPath,
    currentPathRef,
    clearSelection,
    removeSelectionPaths,
    refreshEntriesForPath,
    navigateToPath,
    setError,
    setIsMovingEntry,
    setIsDeletingEntries,
    setIsImportingExternal,
  });

  return {
    drives,
    currentDrive,
    currentPath,
    selectedPaths,
    entries,
    isLoadingDrives,
    isLoadingEntries,
    isLoadingMoreEntries,
    hasMoreEntries,
    totalEntriesCount,
    canGoBack,
    canGoForward,
    isMovingEntry,
    isDeletingEntries,
    isImportingExternal,
    error,
    navigateToPath,
    setSelectedPath,
    selectDrive,
    goUp,
    goBack,
    goForward,
    loadMoreEntries,
    selectEntry,
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
