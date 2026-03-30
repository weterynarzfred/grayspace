import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getSelectedPathsFromState,
  uniqueNonEmptyPaths,
} from "../../../utils/pathSelection";
import useFilesystemDirectoryWatcher from "./useFilesystemDirectoryWatcher";

function sortPathsByEntryOrder(paths, entryPaths) {
  const entryPathIndex = new Map(
    entryPaths.map((path, index) => [path, index]),
  );
  return uniqueNonEmptyPaths(paths).sort((leftPath, rightPath) => (
    (entryPathIndex.get(leftPath) ?? Number.MAX_SAFE_INTEGER)
    - (entryPathIndex.get(rightPath) ?? Number.MAX_SAFE_INTEGER)
  ));
}

function getRangeSelectionPaths(entryPaths, startPath, endPath) {
  const startIndex = entryPaths.indexOf(startPath);
  const endIndex = entryPaths.indexOf(endPath);
  if (startIndex === -1 || endIndex === -1) {
    return [];
  }

  const [fromIndex, toIndex] = startIndex <= endIndex
    ? [startIndex, endIndex]
    : [endIndex, startIndex];
  return entryPaths.slice(fromIndex, toIndex + 1);
}

function normalizeInitialFilesystemState(initialState) {
  const state = initialState ?? {};
  const selectedPaths = getSelectedPathsFromState(state);
  return {
    currentDrive: typeof state.currentDrive === "string" ? state.currentDrive : "",
    currentPath: typeof state.currentPath === "string" ? state.currentPath : "",
    selectedPaths,
    selectionAnchorPath: selectedPaths[selectedPaths.length - 1] ?? "",
  };
}

function getErrorMessage(error, fallbackMessage) {
  return error instanceof Error && error.message ? error.message : fallbackMessage;
}

function useFilesystemNavigation(initialFilesystemState = undefined) {
  const initialStateRef = useRef(
    normalizeInitialFilesystemState(initialFilesystemState),
  );
  const [drives, setDrives] = useState([]);
  const [currentDrive, setCurrentDrive] = useState(initialStateRef.current.currentDrive);
  const [currentPath, setCurrentPath] = useState(initialStateRef.current.currentPath);
  const currentPathRef = useRef(initialStateRef.current.currentPath);
  const [selectedPaths, setSelectedPaths] = useState(initialStateRef.current.selectedPaths);
  const [selectionAnchorPath, setSelectionAnchorPath] = useState(
    initialStateRef.current.selectionAnchorPath,
  );
  const [entries, setEntries] = useState([]);
  const [isLoadingDrives, setIsLoadingDrives] = useState(true);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [isMovingEntry, setIsMovingEntry] = useState(false);
  const [isDeletingEntries, setIsDeletingEntries] = useState(false);
  const [isImportingExternal, setIsImportingExternal] = useState(false);
  const [error, setError] = useState("");
  currentPathRef.current = currentPath;
  const selectedEntryPaths = useMemo(() => {
    const entryPathSet = new Set(entries.map((entry) => entry.path));
    return selectedPaths.filter((path) => entryPathSet.has(path));
  }, [entries, selectedPaths]);

  const applyLoadedEntries = useCallback((nextEntries) => {
    setEntries(nextEntries);
    const visibleEntryPathSet = new Set(nextEntries.map((entry) => entry.path));
    setSelectedPaths((previousSelection) => (
      previousSelection.filter((path) => visibleEntryPathSet.has(path))
    ));
    setSelectionAnchorPath((previousAnchorPath) => (
      visibleEntryPathSet.has(previousAnchorPath) ? previousAnchorPath : ""
    ));
  }, []);

  const refreshEntriesForPath = useCallback(async (pathToRefresh) => {
    const normalizedPath = typeof pathToRefresh === "string" ? pathToRefresh : "";
    if (!normalizedPath) return;

    const refreshedEntries = await invoke("list_directory", { path: normalizedPath });
    if (currentPathRef.current === normalizedPath)
      applyLoadedEntries(refreshedEntries);
  }, [applyLoadedEntries]);

  const handleWatcherError = useCallback((watchError, watchedPath) => {
    if (currentPathRef.current !== watchedPath) return;
    setError(getErrorMessage(watchError, "Failed to refresh folder."));
  }, []);

  function clearSelection() {
    setSelectedPaths([]);
    setSelectionAnchorPath("");
  }

  function clearBrowsingState() {
    setCurrentPath("");
    setCurrentDrive("");
    clearSelection();
    setError("");
  }

  useEffect(() => {
    async function loadDrives() {
      try {
        const availableDrives = await invoke("list_drives");
        setDrives(availableDrives);
      } catch (loadError) {
        setError(getErrorMessage(loadError, "Failed to load drives."));
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
        if (!cancelled) {
          applyLoadedEntries(nextEntries);
        }
      } catch (loadError) {
        if (!cancelled) setError(getErrorMessage(loadError, "Failed to load folder contents."));
      } finally {
        if (!cancelled) setIsLoadingEntries(false);
      }
    }

    loadDirectory();

    return () => {
      cancelled = true;
    };
  }, [applyLoadedEntries, currentPath]);

  useFilesystemDirectoryWatcher({
    currentPath,
    onDirectoryChange: refreshEntriesForPath,
    onWatcherError: handleWatcherError,
  });

  function setSelectedPath(path) {
    const nextPath = typeof path === "string" ? path : "";
    if (!nextPath) {
      clearSelection();
      return [];
    }

    setSelectedPaths([nextPath]);
    setSelectionAnchorPath(nextPath);
    return [nextPath];
  }

  function navigateToPath(path) {
    const nextPath = typeof path === "string" ? path : "";
    if (!nextPath) {
      clearBrowsingState();
      return;
    }

    setCurrentPath(nextPath);
    clearSelection();
    setError("");
  }

  function selectDrive(path) {
    setCurrentDrive(path);
    setCurrentPath(path);
    clearSelection();
    setError("");
  }

  async function goUp() {
    if (!currentPath) return;
    if (currentPath === currentDrive) {
      clearBrowsingState();
      return;
    }

    try {
      const parent = await invoke("parent_path", { path: currentPath });
      if (
        typeof parent !== "string" ||
        !currentDrive ||
        !parent.toLowerCase().startsWith(currentDrive.toLowerCase())
      ) {
        clearBrowsingState();
        return;
      }

      setCurrentPath(parent);
      clearSelection();
      setError("");
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Failed to navigate to parent folder."));
    }
  }

  function selectEntry(entryPath, options = {}) {
    const { additive = false, range = false } = options;
    if (typeof entryPath !== "string" || !entryPath) return selectedEntryPaths;

    const entryPaths = entries.map((entry) => entry.path);
    if (!entryPaths.includes(entryPath)) return selectedEntryPaths;

    if (range) {
      const anchorPath = entryPaths.includes(selectionAnchorPath)
        ? selectionAnchorPath
        : entryPath;
      const rangePaths = getRangeSelectionPaths(entryPaths, anchorPath, entryPath);
      const nextSelection = additive
        ? sortPathsByEntryOrder([...selectedEntryPaths, ...rangePaths], entryPaths)
        : rangePaths;
      setSelectedPaths(nextSelection);
      setSelectionAnchorPath(anchorPath);
      return nextSelection;
    }

    if (additive) {
      const isAlreadySelected = selectedEntryPaths.includes(entryPath);
      const nextSelection = isAlreadySelected
        ? selectedEntryPaths.filter((path) => path !== entryPath)
        : sortPathsByEntryOrder([...selectedEntryPaths, entryPath], entryPaths);
      setSelectedPaths(nextSelection);
      setSelectionAnchorPath(entryPath);
      return nextSelection;
    }

    const nextSelection = [entryPath];
    setSelectedPaths(nextSelection);
    setSelectionAnchorPath(entryPath);
    return nextSelection;
  }

  async function openEntry(entry) {
    if (entry.is_dir) {
      setCurrentPath(entry.path);
      clearSelection();
      setError("");
      return;
    }

    try {
      await invoke("open_path", { path: entry.path });
    } catch (openError) {
      setError(getErrorMessage(openError, "Failed to open file."));
    }
  }

  async function moveEntries(sourcePaths, destinationDir) {
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
      setError(getErrorMessage(moveError, "Failed to move item."));
      moveErrorToThrow = moveError;
    } finally {
      if (activePath && movedPaths.length > 0) {
        try {
          await refreshEntriesForPath(activePath);
        } catch (refreshError) {
          if (!moveErrorToThrow) {
            setError(getErrorMessage(refreshError, "Failed to refresh folder."));
            moveErrorToThrow = refreshError;
          }
        }
      }

      if (movedPaths.length > 0) {
        const movedPathSet = new Set(movedPaths);
        setSelectedPaths((previousSelection) => (
          previousSelection.filter((path) => !movedPathSet.has(path))
        ));
        setSelectionAnchorPath((previousAnchorPath) => (
          movedPathSet.has(previousAnchorPath) ? "" : previousAnchorPath
        ));
      }

      setIsMovingEntry(false);
    }

    if (moveErrorToThrow) throw moveErrorToThrow;
  }

  async function copyEntries(sourcePaths, destinationDir) {
    const normalizedSourcePaths = uniqueNonEmptyPaths(sourcePaths);
    if (!destinationDir || normalizedSourcePaths.length === 0) return;

    const activePath = currentPath;
    let copyErrorToThrow = null;

    setIsMovingEntry(true);
    setError("");

    try {
      await invoke("import_paths", { paths: normalizedSourcePaths, destinationDir });
    } catch (copyError) {
      setError(getErrorMessage(copyError, "Failed to copy item."));
      copyErrorToThrow = copyError;
    } finally {
      if (activePath) {
        try {
          await refreshEntriesForPath(activePath);
        } catch (refreshError) {
          if (!copyErrorToThrow) {
            setError(getErrorMessage(refreshError, "Failed to refresh folder."));
            copyErrorToThrow = refreshError;
          }
        }
      }

      setIsMovingEntry(false);
    }

    if (copyErrorToThrow) throw copyErrorToThrow;
  }

  async function deleteEntries(paths) {
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
        setSelectedPaths((previousSelection) => (
          previousSelection.filter((path) => !deletedPathSet.has(path))
        ));
        setSelectionAnchorPath((previousAnchorPath) => (
          deletedPathSet.has(previousAnchorPath) ? "" : previousAnchorPath
        ));
      }
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, "Failed to delete item."));
      throw deleteError;
    } finally {
      setIsDeletingEntries(false);
    }
  }

  async function importExternalPaths(paths) {
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
      setError(getErrorMessage(importError, "Failed to import dropped items."));
      throw importError;
    } finally {
      setIsImportingExternal(false);
    }
  }

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

export default useFilesystemNavigation;
