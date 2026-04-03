import { useCallback, useRef, useState } from "react";
import { normalizeInitialFilesystemState } from "./filesystemNavigationUtils";
import useFilesystemBrowsingState from "./useFilesystemBrowsingState";
import useFilesystemEntryOperations from "./useFilesystemEntryOperations";
import useFilesystemSelectionState from "./useFilesystemSelectionState";

export default function useFilesystemNavigation(
  initialFilesystemState = undefined,
  options = {},
) {
  const { tabId = "", tabWorkspaceRoot = "" } = options;
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
    setCurrentPath,
    setError,
    navigateToPath,
    selectDrive,
    goUp,
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
      options,
      entryPaths,
      selectedPaths.filter(path => entryPaths.includes(path)),
    );
  }, [entries, selectEntryState, selectedPaths]);

  const {
    openEntry,
    moveEntries,
    copyEntries,
    deleteEntries,
    importExternalPaths,
    undoEntries,
    redoEntries,
  } = useFilesystemEntryOperations({
    tabId,
    tabWorkspaceRoot,
    currentPath,
    currentPathRef,
    clearSelection,
    removeSelectionPaths,
    refreshEntriesForPath,
    setCurrentPath,
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
    isMovingEntry,
    isDeletingEntries,
    isImportingExternal,
    error,
    navigateToPath,
    setSelectedPath,
    selectDrive,
    goUp,
    loadMoreEntries,
    selectEntry,
    openEntry,
    moveEntries,
    copyEntries,
    deleteEntries,
    importExternalPaths,
    undoEntries,
    redoEntries,
  };
}
