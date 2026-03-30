import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import useFilesystemDirectoryWatcher from "./useFilesystemDirectoryWatcher";
import { getNavigationErrorMessage } from "./filesystemNavigationUtils";

export default function useFilesystemBrowsingState({
  initialCurrentDrive = "",
  initialCurrentPath = "",
  clearSelection,
  keepSelectionOnlyInPathSet,
}) {
  const [drives, setDrives] = useState([]);
  const [currentDrive, setCurrentDrive] = useState(initialCurrentDrive);
  const [currentPath, setCurrentPath] = useState(initialCurrentPath);
  const [entries, setEntries] = useState([]);
  const [isLoadingDrives, setIsLoadingDrives] = useState(true);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [error, setError] = useState("");
  const currentPathRef = useRef(initialCurrentPath);

  currentPathRef.current = currentPath;

  const applyLoadedEntries = useCallback((nextEntries) => {
    setEntries(nextEntries);
    const visibleEntryPathSet = new Set(nextEntries.map((entry) => entry.path));
    keepSelectionOnlyInPathSet(visibleEntryPathSet);
  }, [keepSelectionOnlyInPathSet]);

  const refreshEntriesForPath = useCallback(async (pathToRefresh) => {
    const normalizedPath = typeof pathToRefresh === "string" ? pathToRefresh : "";
    if (!normalizedPath) return;

    const refreshedEntries = await invoke("list_directory", { path: normalizedPath });
    if (currentPathRef.current === normalizedPath) applyLoadedEntries(refreshedEntries);
  }, [applyLoadedEntries]);

  const handleWatcherError = useCallback((watchError, watchedPath) => {
    if (currentPathRef.current !== watchedPath) return;
    setError(getNavigationErrorMessage(watchError, "Failed to refresh folder."));
  }, []);

  const clearBrowsingState = useCallback(() => {
    setCurrentPath("");
    setCurrentDrive("");
    clearSelection();
    setError("");
  }, [clearSelection]);

  useEffect(() => {
    async function loadDrives() {
      try {
        const availableDrives = await invoke("list_drives");
        setDrives(availableDrives);
      } catch (loadError) {
        setError(getNavigationErrorMessage(loadError, "Failed to load drives."));
      } finally {
        setIsLoadingDrives(false);
      }
    }

    loadDrives();
  }, []);

  useEffect(() => {
    if (!currentPath) {
      setEntries([]);
      clearSelection();
      setIsLoadingEntries(false);
      return;
    }

    let cancelled = false;

    async function loadDirectory() {
      setIsLoadingEntries(true);
      setError("");

      try {
        const nextEntries = await invoke("list_directory", { path: currentPath });
        if (!cancelled) applyLoadedEntries(nextEntries);
      } catch (loadError) {
        if (!cancelled) {
          setError(getNavigationErrorMessage(loadError, "Failed to load folder contents."));
        }
      } finally {
        if (!cancelled) setIsLoadingEntries(false);
      }
    }

    loadDirectory();
    return () => {
      cancelled = true;
    };
  }, [applyLoadedEntries, clearSelection, currentPath]);

  useFilesystemDirectoryWatcher({
    currentPath,
    onDirectoryChange: refreshEntriesForPath,
    onWatcherError: handleWatcherError,
  });

  const navigateToPath = useCallback((path) => {
    const nextPath = typeof path === "string" ? path : "";
    if (!nextPath) {
      clearBrowsingState();
      return;
    }

    setCurrentPath(nextPath);
    clearSelection();
    setError("");
  }, [clearBrowsingState, clearSelection]);

  const selectDrive = useCallback((path) => {
    setCurrentDrive(path);
    setCurrentPath(path);
    clearSelection();
    setError("");
  }, [clearSelection]);

  const goUp = useCallback(async () => {
    if (!currentPath) return;
    if (currentPath === currentDrive) {
      clearBrowsingState();
      return;
    }

    try {
      const parent = await invoke("parent_path", { path: currentPath });
      if (
        typeof parent !== "string"
        || !currentDrive
        || !parent.toLowerCase().startsWith(currentDrive.toLowerCase())
      ) {
        clearBrowsingState();
        return;
      }

      setCurrentPath(parent);
      clearSelection();
      setError("");
    } catch (loadError) {
      setError(getNavigationErrorMessage(loadError, "Failed to navigate to parent folder."));
    }
  }, [clearBrowsingState, clearSelection, currentDrive, currentPath]);

  return {
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
  };
}
