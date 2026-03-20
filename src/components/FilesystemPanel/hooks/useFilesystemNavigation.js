import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";

function uniqueNonEmptyPaths(paths) {
  const seen = new Set();
  const normalizedPaths = [];

  paths.forEach((path) => {
    if (typeof path !== "string" || !path) return;
    if (seen.has(path)) return;
    seen.add(path);
    normalizedPaths.push(path);
  });

  return normalizedPaths;
}

function buildInitialSelectedPaths(state) {
  const selectedPath = typeof state.selectedPath === "string" ? state.selectedPath : "";
  const selectedPathsFromState = Array.isArray(state.selectedPaths) ? state.selectedPaths : [];
  return uniqueNonEmptyPaths([...selectedPathsFromState, selectedPath]);
}

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
  const selectedPaths = buildInitialSelectedPaths(state);
  return {
    currentDrive: typeof state.currentDrive === "string" ? state.currentDrive : "",
    currentPath: typeof state.currentPath === "string" ? state.currentPath : "",
    selectedPaths,
    selectionAnchorPath: selectedPaths[selectedPaths.length - 1] ?? "",
  };
}

function useFilesystemNavigation(initialFilesystemState = undefined) {
  const initialStateRef = useRef(
    normalizeInitialFilesystemState(initialFilesystemState),
  );
  const [drives, setDrives] = useState([]);
  const [currentDrive, setCurrentDrive] = useState(initialStateRef.current.currentDrive);
  const [currentPath, setCurrentPath] = useState(initialStateRef.current.currentPath);
  const [selectedPaths, setSelectedPaths] = useState(initialStateRef.current.selectedPaths);
  const [selectionAnchorPath, setSelectionAnchorPath] = useState(
    initialStateRef.current.selectionAnchorPath,
  );
  const [entries, setEntries] = useState([]);
  const [isLoadingDrives, setIsLoadingDrives] = useState(true);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [isMovingEntry, setIsMovingEntry] = useState(false);
  const [isImportingExternal, setIsImportingExternal] = useState(false);
  const [error, setError] = useState("");
  const selectedPath = selectedPaths.includes(selectionAnchorPath)
    ? selectionAnchorPath
    : (selectedPaths[selectedPaths.length - 1] ?? "");
  const selectedEntryPaths = useMemo(() => {
    const entryPathSet = new Set(entries.map((entry) => entry.path));
    return selectedPaths.filter((path) => entryPathSet.has(path));
  }, [entries, selectedPaths]);

  useEffect(() => {
    async function loadDrives() {
      try {
        const availableDrives = await invoke("list_drives");
        setDrives(availableDrives);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load drives.");
      } finally {
        setIsLoadingDrives(false);
      }
    }

    loadDrives();
  }, []);

  useEffect(() => {
    if (!currentPath) {
      setEntries([]);
      setSelectedPaths([]);
      setSelectionAnchorPath("");
      return;
    }

    let cancelled = false;

    async function loadDirectory() {
      setIsLoadingEntries(true);
      setError("");

      try {
        const nextEntries = await invoke("list_directory", { path: currentPath });
        if (!cancelled) {
          setEntries(nextEntries);
          const visibleEntryPathSet = new Set(nextEntries.map((entry) => entry.path));
          setSelectedPaths((previousSelection) => (
            previousSelection.filter((path) => visibleEntryPathSet.has(path))
          ));
          setSelectionAnchorPath((previousAnchorPath) => (
            visibleEntryPathSet.has(previousAnchorPath) ? previousAnchorPath : ""
          ));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load folder contents.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingEntries(false);
        }
      }
    }

    loadDirectory();

    return () => {
      cancelled = true;
    };
  }, [currentPath]);

  function setSelectedPath(path) {
    const nextPath = typeof path === "string" ? path : "";
    if (!nextPath) {
      setSelectedPaths([]);
      setSelectionAnchorPath("");
      return;
    }

    setSelectedPaths([nextPath]);
    setSelectionAnchorPath(nextPath);
  }

  function navigateToPath(path) {
    const nextPath = typeof path === "string" ? path : "";
    if (!nextPath) {
      setCurrentPath("");
      setCurrentDrive("");
      setSelectedPaths([]);
      setSelectionAnchorPath("");
      setError("");
      return;
    }

    setCurrentPath(nextPath);
    setSelectedPaths([]);
    setSelectionAnchorPath("");
    setError("");
  }

  function selectDrive(path) {
    setCurrentDrive(path);
    setCurrentPath(path);
    setSelectedPaths([]);
    setSelectionAnchorPath("");
    setError("");
  }

  async function goUp() {
    if (!currentPath) {
      return;
    }

    if (currentPath === currentDrive) {
      setCurrentPath("");
      setCurrentDrive("");
      setSelectedPaths([]);
      setSelectionAnchorPath("");
      setError("");
      return;
    }

    try {
      const parent = await invoke("parent_path", { path: currentPath });
      if (
        typeof parent !== "string" ||
        !currentDrive ||
        !parent.toLowerCase().startsWith(currentDrive.toLowerCase())
      ) {
        setCurrentPath("");
        setCurrentDrive("");
        setSelectedPaths([]);
        setSelectionAnchorPath("");
        return;
      }

      setCurrentPath(parent);
      setSelectedPaths([]);
      setSelectionAnchorPath("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to navigate to parent folder.");
    }
  }

  function selectEntry(entryPath, options = {}) {
    const { additive = false, range = false } = options;
    if (typeof entryPath !== "string" || !entryPath) {
      return;
    }

    const entryPaths = entries.map((entry) => entry.path);
    if (!entryPaths.includes(entryPath)) {
      return;
    }

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
      return;
    }

    if (additive) {
      const isAlreadySelected = selectedEntryPaths.includes(entryPath);
      const nextSelection = isAlreadySelected
        ? selectedEntryPaths.filter((path) => path !== entryPath)
        : sortPathsByEntryOrder([...selectedEntryPaths, entryPath], entryPaths);
      setSelectedPaths(nextSelection);
      setSelectionAnchorPath(entryPath);
      return;
    }

    setSelectedPaths([entryPath]);
    setSelectionAnchorPath(entryPath);
  }

  async function openEntry(entry) {
    if (entry.is_dir) {
      setCurrentPath(entry.path);
      setSelectedPaths([]);
      setSelectionAnchorPath("");
      return;
    }

    try {
      await invoke("open_path", { path: entry.path });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Failed to open file.");
    }
  }

  async function moveEntries(sourcePaths, destinationDir) {
    const normalizedSourcePaths = uniqueNonEmptyPaths(sourcePaths);
    if (!destinationDir || normalizedSourcePaths.length === 0) {
      return;
    }

    const activePath = currentPath;
    const movedPaths = [];
    let moveErrorToThrow = null;

    setIsMovingEntry(true);
    setError("");

    try {
      for (const sourcePath of normalizedSourcePaths) {
        if (!sourcePath || sourcePath === destinationDir) {
          continue;
        }
        await invoke("move_path", { source: sourcePath, destinationDir });
        movedPaths.push(sourcePath);
      }
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Failed to move item.");
      moveErrorToThrow = moveError;
    } finally {
      if (activePath && movedPaths.length > 0) {
        try {
          const refreshedEntries = await invoke("list_directory", { path: activePath });
          setEntries(refreshedEntries);
        } catch (refreshError) {
          if (!moveErrorToThrow) {
            setError(refreshError instanceof Error ? refreshError.message : "Failed to refresh folder.");
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

    if (moveErrorToThrow) {
      throw moveErrorToThrow;
    }
  }

  async function moveEntry(sourcePath, destinationDir) {
    await moveEntries([sourcePath], destinationDir);
  }

  async function importExternalPaths(paths) {
    if (!currentPath || !Array.isArray(paths) || paths.length === 0) {
      return;
    }

    const activePath = currentPath;

    setIsImportingExternal(true);
    setError("");

    try {
      await invoke("import_paths", { paths, destinationDir: activePath });

      const refreshedEntries = await invoke("list_directory", { path: activePath });
      setEntries(refreshedEntries);
      setSelectedPaths([]);
      setSelectionAnchorPath("");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Failed to import dropped items.");
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
    selectedPath,
    selectedEntryPaths,
    entries,
    isLoadingDrives,
    isLoadingEntries,
    isMovingEntry,
    isImportingExternal,
    error,
    navigateToPath,
    setSelectedPath,
    selectDrive,
    goUp,
    selectEntry,
    openEntry,
    moveEntry,
    moveEntries,
    importExternalPaths,
  };
}

export default useFilesystemNavigation;
