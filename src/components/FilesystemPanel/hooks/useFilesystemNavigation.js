import { useCallback, useRef, useState } from "react";
import { normalizeInitialFilesystemState } from "./filesystemNavigationUtils";
import useFilesystemBrowsingState from "./useFilesystemBrowsingState";
import useFilesystemEntryOperations from "./useFilesystemEntryOperations";
import useFilesystemSelectionState from "./useFilesystemSelectionState";
import useFilesystemTransfers from "./useFilesystemTransfers";

export default function useFilesystemNavigation(
  initialFilesystemState = undefined,
  options = {},
) {
  const {
    tabId = "",
    tabWorkspaceRoot = "",
    pushNotification = undefined,
    openChoice = undefined,
    sortKey = "name",
    sortDescending = false,
  } = options;
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
    hasLoadedCurrentPath,
    error,
    canGoBack,
    canGoForward,
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,
    isSearchActive,
    searchStatus,
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
    sortKey,
    sortDescending,
  });

  const [isMovingEntry, setIsMovingEntry] = useState(false);
  const [isDeletingEntries, setIsDeletingEntries] = useState(false);
  const [isImportingExternal, setIsImportingExternal] = useState(false);
  const {
    transferProgress,
    beginTransfer,
    advanceTransfer,
    endTransfer,
    cancelTransfer,
    resolveConflicts,
  } = useFilesystemTransfers({ openChoice });

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
    beginTransfer,
    advanceTransfer,
    endTransfer,
    resolveConflicts,
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
    hasLoadedCurrentPath,
    canGoBack,
    canGoForward,
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,
    isSearchActive,
    searchStatus,
    isMovingEntry,
    isDeletingEntries,
    isImportingExternal,
    transferProgress,
    cancelTransfer,
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
