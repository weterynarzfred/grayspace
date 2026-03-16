import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

function useFilesystemNavigation() {
  const [drives, setDrives] = useState([]);
  const [currentDrive, setCurrentDrive] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [entries, setEntries] = useState([]);
  const [isLoadingDrives, setIsLoadingDrives] = useState(true);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [isMovingEntry, setIsMovingEntry] = useState(false);
  const [error, setError] = useState("");

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
      setSelectedPath("");
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

  function selectDrive(path) {
    setCurrentDrive(path);
    setCurrentPath(path);
    setSelectedPath("");
    setError("");
  }

  async function goUp() {
    if (!currentPath) {
      return;
    }

    if (currentPath === currentDrive) {
      setCurrentPath("");
      setCurrentDrive("");
      setSelectedPath("");
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
        setSelectedPath("");
        return;
      }

      setCurrentPath(parent);
      setSelectedPath("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to navigate to parent folder.");
    }
  }

  function selectEntry(entryPath) {
    setSelectedPath(entryPath);
  }

  async function openEntry(entry) {
    if (entry.is_dir) {
      setCurrentPath(entry.path);
      setSelectedPath("");
      return;
    }

    try {
      await invoke("open_path", { path: entry.path });
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Failed to open file.");
    }
  }

  async function moveEntry(sourcePath, destinationDir) {
    if (!sourcePath || !destinationDir || sourcePath === destinationDir) {
      return;
    }

    const activePath = currentPath;

    setIsMovingEntry(true);
    setError("");

    try {
      await invoke("move_path", { source: sourcePath, destinationDir });

      if (activePath) {
        const refreshedEntries = await invoke("list_directory", { path: activePath });
        setEntries(refreshedEntries);
      }

      if (selectedPath === sourcePath) {
        setSelectedPath("");
      }
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Failed to move item.");
      throw moveError;
    } finally {
      setIsMovingEntry(false);
    }
  }

  return {
    drives,
    currentDrive,
    currentPath,
    selectedPath,
    entries,
    isLoadingDrives,
    isLoadingEntries,
    isMovingEntry,
    error,
    setCurrentPath,
    setSelectedPath,
    selectDrive,
    goUp,
    selectEntry,
    openEntry,
    moveEntry,
  };
}

export default useFilesystemNavigation;
