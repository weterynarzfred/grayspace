import { useCallback, useMemo, useRef, useState } from "react";
import { normalizeInitialFilesystemState } from "./filesystemNavigationUtils";
import useFilesystemBrowsingState from "./useFilesystemBrowsingState";
import useFilesystemEntryOperations from "./useFilesystemEntryOperations";
import useFilesystemSelectionState from "./useFilesystemSelectionState";

export default function useFilesystemNavigation(initialFilesystemState = undefined) {
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
    error,
    setCurrentPath,
    setError,
    navigateToPath,
    selectDrive,
    goUp,
    refreshEntriesForPath,
  } = useFilesystemBrowsingState({
    initialCurrentDrive: initialStateRef.current.currentDrive,
    initialCurrentPath: initialStateRef.current.currentPath,
    clearSelection,
    keepSelectionOnlyInPathSet,
  });

  const [isMovingEntry, setIsMovingEntry] = useState(false);
  const [isDeletingEntries, setIsDeletingEntries] = useState(false);
  const [isImportingExternal, setIsImportingExternal] = useState(false);

  const selectedEntryPaths = useMemo(() => {
    const entryPathSet = new Set(entries.map(entry => entry.path));
    return selectedPaths.filter(path => entryPathSet.has(path));
  }, [entries, selectedPaths]);

  const selectEntry = useCallback((entryPath, options = {}) => {
    const entryPaths = Array.isArray(options.entryPaths) && options.entryPaths.length > 0
      ? options.entryPaths
      : entries.map(entry => entry.path);
    const selectedVisiblePaths = selectedPaths.filter(path => entryPaths.includes(path));
    return selectEntryState(entryPath, options, entryPaths, selectedVisiblePaths);
  }, [entries, selectEntryState, selectedPaths]);

  const {
    openEntry,
    moveEntries,
    copyEntries,
    deleteEntries,
    importExternalPaths,
  } = useFilesystemEntryOperations({
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
    selectedEntryPaths,
    entries,
    isLoadingDrives,
    isLoadingEntries,
    isMovingEntry,
    isDeletingEntries,
    isImportingExternal,
    error,
    navigateToPath,
    setSelectedPath,
    selectDrive,
    goUp,
    selectEntry,
    openEntry,
    moveEntries,
    copyEntries,
    deleteEntries,
    importExternalPaths,
  };
}
