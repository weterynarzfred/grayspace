import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import useFilesystemDirectoryWatcher from "./useFilesystemDirectoryWatcher";
import {
  DIRECTORY_PAGE_SIZE,
  listDirectoryPage,
  MAX_REFRESH_ENTRY_COUNT,
} from "./filesystemPagingApi";
import { getNavigationErrorMessage } from "./filesystemNavigationUtils";

function mergeEntryPages(existingEntries, pageEntries) {
  if (!Array.isArray(pageEntries) || pageEntries.length === 0) return existingEntries;
  const seenPaths = new Set(existingEntries.map((entry) => entry.path));
  const mergedEntries = [...existingEntries];

  pageEntries.forEach((entry) => {
    const entryPath = typeof entry?.path === "string" ? entry.path : "";
    if (!entryPath || seenPaths.has(entryPath)) return;
    seenPaths.add(entryPath);
    mergedEntries.push(entry);
  });

  return mergedEntries;
}

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
  const [isLoadingMoreEntries, setIsLoadingMoreEntries] = useState(false);
  const [hasMoreEntries, setHasMoreEntries] = useState(false);
  const [totalEntriesCount, setTotalEntriesCount] = useState(0);
  const [error, setError] = useState("");
  const currentPathRef = useRef(initialCurrentPath);
  const entriesRef = useRef([]);
  const loadMoreInFlightRef = useRef(false);

  currentPathRef.current = currentPath;
  entriesRef.current = entries;

  const applyLoadedEntries = useCallback((nextEntries) => {
    setEntries(nextEntries);
    const visibleEntryPathSet = new Set(nextEntries.map((entry) => entry.path));
    keepSelectionOnlyInPathSet(visibleEntryPathSet);
  }, [keepSelectionOnlyInPathSet]);

  const loadEntriesUpToCount = useCallback(async (pathToLoad, targetCount, options = {}) => {
    const { refresh = false } = options;
    const normalizedPath = typeof pathToLoad === "string" ? pathToLoad : "";
    if (!normalizedPath) {
      return {
        entries: [],
        hasMore: false,
        totalCount: 0,
      };
    }

    const normalizedTargetCount = Math.max(1, targetCount ?? DIRECTORY_PAGE_SIZE);
    const mergedEntries = [];
    let hasMore = false;
    let totalCount = 0;
    let offset = 0;

    while (mergedEntries.length < normalizedTargetCount) {
      const pageLimit = Math.min(DIRECTORY_PAGE_SIZE, normalizedTargetCount - mergedEntries.length);
      const page = await listDirectoryPage(normalizedPath, offset, pageLimit, {
        refresh: refresh && offset === 0,
      });
      const pageEntries = page.entries;
      if (pageEntries.length === 0) {
        hasMore = false;
        break;
      }

      mergedEntries.push(...pageEntries);
      offset += pageEntries.length;
      hasMore = page.hasMore;
      totalCount = Math.max(totalCount, page.totalCount);
      if (!hasMore) break;
    }

    return {
      entries: mergedEntries,
      hasMore,
      totalCount: Math.max(totalCount, mergedEntries.length),
    };
  }, []);

  const refreshEntriesForPath = useCallback(async (pathToRefresh) => {
    const normalizedPath = typeof pathToRefresh === "string" ? pathToRefresh : "";
    if (!normalizedPath) return;

    const targetCount = Math.max(
      DIRECTORY_PAGE_SIZE,
      Math.min(entriesRef.current.length || DIRECTORY_PAGE_SIZE, MAX_REFRESH_ENTRY_COUNT),
    );

    try {
      const refreshedPage = await loadEntriesUpToCount(normalizedPath, targetCount, {
        refresh: true,
      });
      if (currentPathRef.current !== normalizedPath) return;
      applyLoadedEntries(refreshedPage.entries);
      setHasMoreEntries(refreshedPage.hasMore);
      setTotalEntriesCount(refreshedPage.totalCount);
    } catch (refreshError) {
      if (currentPathRef.current !== normalizedPath) return;
      setError(getNavigationErrorMessage(refreshError, "Failed to refresh folder."));
    }
  }, [applyLoadedEntries, loadEntriesUpToCount]);

  const handleWatcherError = useCallback((watchError, watchedPath) => {
    if (currentPathRef.current !== watchedPath) return;
    setError(getNavigationErrorMessage(watchError, "Failed to refresh folder."));
  }, []);

  const clearBrowsingState = useCallback(() => {
    setCurrentPath("");
    setCurrentDrive("");
    setEntries([]);
    setHasMoreEntries(false);
    setTotalEntriesCount(0);
    setIsLoadingMoreEntries(false);
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
      setHasMoreEntries(false);
      setTotalEntriesCount(0);
      setIsLoadingMoreEntries(false);
      clearSelection();
      setIsLoadingEntries(false);
      return;
    }

    let cancelled = false;

    async function loadDirectory() {
      setIsLoadingEntries(true);
      setIsLoadingMoreEntries(false);
      setError("");

      try {
        const firstPage = await listDirectoryPage(currentPath, 0, DIRECTORY_PAGE_SIZE, {
          refresh: true,
        });
        if (!cancelled) {
          applyLoadedEntries(firstPage.entries);
          setHasMoreEntries(firstPage.hasMore);
          setTotalEntriesCount(firstPage.totalCount);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(getNavigationErrorMessage(loadError, "Failed to load folder contents."));
          setHasMoreEntries(false);
          setTotalEntriesCount(0);
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

  const loadMoreEntries = useCallback(async () => {
    const pathToLoad = currentPathRef.current;
    if (
      !pathToLoad
      || isLoadingEntries
      || isLoadingMoreEntries
      || !hasMoreEntries
      || loadMoreInFlightRef.current
    ) {
      return;
    }

    const offset = entriesRef.current.length;
    loadMoreInFlightRef.current = true;
    setIsLoadingMoreEntries(true);

    try {
      const nextPage = await listDirectoryPage(
        pathToLoad,
        offset,
        DIRECTORY_PAGE_SIZE,
      );
      if (currentPathRef.current !== pathToLoad) return;

      let mergedEntries = [];
      setEntries((previousEntries) => {
        mergedEntries = mergeEntryPages(previousEntries, nextPage.entries);
        return mergedEntries;
      });
      setHasMoreEntries(nextPage.hasMore);
      setTotalEntriesCount(Math.max(nextPage.totalCount, mergedEntries.length));
    } catch (loadError) {
      if (currentPathRef.current !== pathToLoad) return;
      setError(getNavigationErrorMessage(loadError, "Failed to load more entries."));
    } finally {
      loadMoreInFlightRef.current = false;
      if (currentPathRef.current === pathToLoad) setIsLoadingMoreEntries(false);
    }
  }, [hasMoreEntries, isLoadingEntries, isLoadingMoreEntries]);

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
  };
}
