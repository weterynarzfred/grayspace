import {
  DndContext,
  DragOverlay,
  pointerWithin,
} from "@dnd-kit/core";
import Breadcrumbs, { buildBreadcrumbs } from "./Breadcrumbs";
import DraggableFilesystemEntry from "./DraggableFilesystemEntry";
import EntryItem from "./EntryItem";
import UpEntryDropTarget from "./UpEntryDropTarget";
import useFilesystemDnd from "./hooks/useFilesystemDnd";
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
    isMovingEntry,
    error,
    setCurrentPath,
    setSelectedPath,
    selectDrive,
    goUp,
    selectEntry,
    openEntry,
    moveEntry,
  } = useFilesystemNavigation();
  const isBrowsing = currentPath !== "";
  const {
    sensors,
    activeDragPath,
    getBreadcrumbDropId,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  } = useFilesystemDnd({
    entries,
    currentPath,
    isMovingEntry,
    moveEntry,
  });
  const activeDragEntry = entries.find((entry) => entry.path === activeDragPath) ?? null;
  const breadcrumbs = buildBreadcrumbs(currentPath, currentDrive);
  const upDestinationPath =
    breadcrumbs.length > 2 ? breadcrumbs[breadcrumbs.length - 2].path : "";

  return (
    <section className={`${styles.panelContent} ${styles.panelList}`} aria-label="Filesystem panel">
      <h2 className={styles.title}>{isBrowsing ? "Files" : "Drives"}</h2>
      {!isBrowsing && <p className={styles.muted}>Select a drive</p>}
      {isLoadingDrives && !isBrowsing && <p className={styles.muted}>Loading drives...</p>}
      {isLoadingEntries && isBrowsing && <p className={styles.muted}>Loading folder contents...</p>}
      {isMovingEntry && isBrowsing && <p className={styles.muted}>Moving item...</p>}
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

      {isBrowsing && (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          autoScroll={false}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <Breadcrumbs
            currentPath={currentPath}
            currentDrive={currentDrive}
            onSelect={setCurrentPath}
            activeDragPath={activeDragPath}
            isMovingEntry={isMovingEntry}
            getDropIdForPath={getBreadcrumbDropId}
          />

          {!isLoadingEntries && !error && (
            <ul className={styles.entryList}>
              <UpEntryDropTarget
                destinationPath={upDestinationPath}
                isSelected={selectedPath === upEntrySelectionId}
                isMovingEntry={isMovingEntry}
                activeDragPath={activeDragPath}
                onClick={() => setSelectedPath(upEntrySelectionId)}
                onDoubleClick={goUp}
              />
              {entries.map((entry) => (
                <DraggableFilesystemEntry
                  key={entry.path}
                  entry={entry}
                  isSelected={selectedPath === entry.path}
                  isMovingEntry={isMovingEntry}
                  activeDragPath={activeDragPath}
                  onClick={() => selectEntry(entry.path)}
                  onDoubleClick={() => openEntry(entry)}
                />
              ))}
            </ul>
          )}
          <DragOverlay dropAnimation={null}>
            {activeDragEntry && (
              <div className={styles.dragOverlay}>
                <span className={styles.dragOverlayName}>{activeDragEntry.name}</span>
                <span className={styles.dragOverlayMeta}>
                  {activeDragEntry.is_dir ? "Folder" : "File"}
                </span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </section>
  );
}

export default FilesystemPanel;
