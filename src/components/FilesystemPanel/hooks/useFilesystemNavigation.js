import { useCallback, useEffect, useRef } from "react";
import { isPathInsideRoot, isSamePath } from "../../../utils/pathWatch";
import { getPaneHistoryKey } from "../operations/filesystemOperationHistory";
import { onFilesystemOperationFinished } from "../operations/filesystemOperationQueue";
import { normalizeInitialFilesystemState } from "./filesystemNavigationUtils";
import useFilesystemBrowsingState from "./useFilesystemBrowsingState";
import useFilesystemEntryOperations from "./useFilesystemEntryOperations";
import useFilesystemQueuedOperations from "./useFilesystemQueuedOperations";
import useFilesystemSelectionState from "./useFilesystemSelectionState";

export default function useFilesystemNavigation(
  initialFilesystemState = undefined,
  options = {},
) {
  const {
    tabId = "",
    paneId = "",
    tabWorkspaceRoot = "",
    pushNotification = undefined,
    openChoice = undefined,
    sortKey = "name",
    sortDescending = false,
    searchOptions = undefined,
    showHidden = true,
  } = options;
  const initialStateRef = useRef(
    normalizeInitialFilesystemState(initialFilesystemState),
  );

  const {
    selectedPaths,
    selectionFocusPath,
    clearSelection,
    keepSelectionWhere,
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
    searchError,
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
    keepSelectionWhere,
    sortKey,
    sortDescending,
    searchOptions,
    showHidden,
  });

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

  const paneKey = getPaneHistoryKey(tabId, paneId);
  const {
    openEntry,
    renameEntry,
    createTextFile,
    createFolder,
  } = useFilesystemEntryOperations({
    tabId,
    tabWorkspaceRoot,
    paneKey,
    currentPath,
    clearSelection,
    refreshEntriesForPath,
    navigateToPath,
    setError,
  });
  const {
    moveEntries,
    copyEntries,
    importExternalPaths,
    deleteEntries,
    undoEntries,
    redoEntries,
  } = useFilesystemQueuedOperations({ tabId, paneKey, openChoice, pushNotification });

  // What an operation of the tab moved or deleted can't stay selected, and the folder on screen is
  // listed again if the operation changed it (watchers cover the rest). Only then: a listing loads
  // at most MAX_REFRESH_ENTRY_COUNT entries again and drops the selection beyond them, and a search
  // reruns. The store says so, not the operation: the pane that started it may have remounted
  // since, and every pane of the tab shows its results.
  useEffect(() => onFilesystemOperationFinished((operation) => {
    if (operation.tabId !== tabId) return;
    removeSelectionPaths(new Set(operation.removedPaths));
    const shownPath = currentPathRef.current;
    // A search lists the whole subtree.
    const isShownChanged = operation.changedFolders.some((folder) => (isSearchActive
      ? isPathInsideRoot(folder, shownPath)
      : isSamePath(folder, shownPath)));
    if (isShownChanged) refreshEntriesForPath(shownPath);
  }), [currentPathRef, isSearchActive, refreshEntriesForPath, removeSelectionPaths, tabId]);

  return {
    drives,
    currentDrive,
    currentPath,
    selectedPaths,
    selectionFocusPath,
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
    searchError,
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
