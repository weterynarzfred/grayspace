import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import styles from "./FilesystemPanel.module.scss";

function FilesystemPanel() {
  const [drives, setDrives] = useState([]);
  const [currentDrive, setCurrentDrive] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState([]);
  const [isLoadingDrives, setIsLoadingDrives] = useState(true);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [error, setError] = useState("");
  const isBrowsing = currentPath !== "";

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
    setError("");
  }

  async function goUp() {
    if (!currentPath) {
      return;
    }

    if (currentPath === currentDrive) {
      setCurrentPath("");
      setCurrentDrive("");
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
        return;
      }

      setCurrentPath(parent);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to navigate to parent folder.");
    }
  }

  function handleEntryClick(entry) {
    if (entry.is_dir) {
      setCurrentPath(entry.path);
    }
  }

  function getBreadcrumbs() {
    if (!currentPath || !currentDrive) {
      return [];
    }

    const separator = currentDrive.includes("\\") ? "\\" : "/";
    const driveRoot = currentDrive.replace(/[\\/]+$/, "");
    const normalizedCurrentPath = currentPath.replace(/[\\/]+$/, "");

    const crumbs = [{ label: currentDrive, path: currentDrive }];
    const remainder = normalizedCurrentPath
      .slice(driveRoot.length)
      .replace(/^[\\/]+/, "");

    if (!remainder) {
      return crumbs;
    }

    let runningPath = driveRoot;
    const parts = remainder.split(/[\\/]+/).filter(Boolean);

    for (const part of parts) {
      runningPath = `${runningPath}${separator}${part}`;
      crumbs.push({ label: part, path: runningPath });
    }

    return crumbs;
  }

  const breadcrumbs = getBreadcrumbs();

  return (
    <section className={`${styles.panelContent} ${styles.panelList}`} aria-label="Filesystem panel">
      <h2 className={styles.title}>{isBrowsing ? "Files" : "Drives"}</h2>
      {!isBrowsing && <p className={styles.muted}>Select a drive</p>}
      {isBrowsing && (
        <nav className={styles.breadcrumbs} aria-label="Current path">
          {breadcrumbs.map((crumb, index) => (
            <button
              key={crumb.path}
              type="button"
              className={styles.crumbButton}
              onClick={() => setCurrentPath(crumb.path)}
            >
              {index > 0 && <span className={styles.crumbSeparator}>/</span>}
              <span>{crumb.label}</span>
            </button>
          ))}
        </nav>
      )}
      {isLoadingDrives && !isBrowsing && <p className={styles.muted}>Loading drives...</p>}
      {isLoadingEntries && isBrowsing && <p className={styles.muted}>Loading folder contents...</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!isBrowsing && !isLoadingDrives && !error && (
        <ul className={styles.entryList}>
          {drives.map((drive) => (
            <li key={drive.path} className={styles.entryItem}>
              <button
                type="button"
                className={`${styles.entryButton} ${currentDrive === drive.path ? styles.selected : ""}`}
                onClick={() => selectDrive(drive.path)}
              >
                <span className={styles.entryName}>{drive.name}</span>
                <span className={styles.entryPath}>{drive.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {isBrowsing && !isLoadingEntries && !error && (
        <ul className={styles.entryList}>
          <li className={styles.entryItem}>
            <button type="button" className={styles.entryButton} onClick={goUp}>
              <span className={styles.entryName}>..</span>
              <span className={styles.entryPath}>Up</span>
            </button>
          </li>
          {entries.map((entry) => (
            <li key={entry.path} className={styles.entryItem}>
              <button
                type="button"
                className={`${styles.entryButton} ${entry.is_dir ? "" : styles.file}`}
                onClick={() => handleEntryClick(entry)}
              >
                <span className={styles.entryName}>{entry.name}</span>
                <span className={styles.entryPath}>{entry.is_dir ? "Folder" : "File"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default FilesystemPanel;
