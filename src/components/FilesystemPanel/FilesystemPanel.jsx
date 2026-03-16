import Breadcrumbs from "./Breadcrumbs";
import EntryItem from "./EntryItem";
import useFilesystemNavigation from "./hooks/useFilesystemNavigation";
import styles from "./FilesystemPanel.module.scss";

function FilesystemPanel() {
  const upEntrySelectionId = "__up__";
  const {
    drives,
    currentDrive,
    currentPath,
    selectedPath,
    entries,
    isLoadingDrives,
    isLoadingEntries,
    error,
    setCurrentPath,
    setSelectedPath,
    selectDrive,
    goUp,
    selectEntry,
    openEntry,
  } = useFilesystemNavigation();
  const isBrowsing = currentPath !== "";

  return (
    <section className={`${styles.panelContent} ${styles.panelList}`} aria-label="Filesystem panel">
      <h2 className={styles.title}>{isBrowsing ? "Files" : "Drives"}</h2>
      {!isBrowsing && <p className={styles.muted}>Select a drive</p>}
      {isBrowsing && (
        <Breadcrumbs
          currentPath={currentPath}
          currentDrive={currentDrive}
          onSelect={setCurrentPath}
        />
      )}
      {isLoadingDrives && !isBrowsing && <p className={styles.muted}>Loading drives...</p>}
      {isLoadingEntries && isBrowsing && <p className={styles.muted}>Loading folder contents...</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!isBrowsing && !isLoadingDrives && !error && (
        <ul className={styles.entryList}>
          {drives.map((drive) => (
            <EntryItem
              key={drive.path}
              label={drive.name}
              meta={drive.path}
              isSelected={selectedPath === drive.path}
              onClick={() => setSelectedPath(drive.path)}
              onDoubleClick={() => selectDrive(drive.path)}
            />
          ))}
        </ul>
      )}

      {isBrowsing && !isLoadingEntries && !error && (
        <ul className={styles.entryList}>
          <EntryItem
            label=".."
            meta="Up"
            isSelected={selectedPath === upEntrySelectionId}
            onClick={() => setSelectedPath(upEntrySelectionId)}
            onDoubleClick={goUp}
          />
          {entries.map((entry) => (
            <EntryItem
              key={entry.path}
              label={entry.name}
              meta={entry.is_dir ? "Folder" : "File"}
              isSelected={selectedPath === entry.path}
              isFile={!entry.is_dir}
              onClick={() => selectEntry(entry.path)}
              onDoubleClick={() => openEntry(entry)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export default FilesystemPanel;
