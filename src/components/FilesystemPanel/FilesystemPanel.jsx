import {
  DndContext,
  DragOverlay,
  pointerWithin,
} from "@dnd-kit/core";
import Breadcrumbs, { buildBreadcrumbs } from "./Breadcrumbs";
import DraggableFilesystemEntry from "./DraggableFilesystemEntry";
import EntryItem from "./EntryItem";
import FilesystemStatusMessages from "./FilesystemStatusMessages";
import UpEntryDropTarget from "./UpEntryDropTarget";
import useFilesystemDnd from "./hooks/useFilesystemDnd";
import useFilesystemNavigation from "./hooks/useFilesystemNavigation";
import styles from "./FilesystemPanel.module.scss";

const UP_ENTRY_SELECTION_ID = "__up__";

function FilesystemPanel() {
  const nav = useFilesystemNavigation();
  const isBrowsing = nav.currentPath !== "";
  const dnd = useFilesystemDnd({
    entries: nav.entries,
    currentPath: nav.currentPath,
    isMovingEntry: nav.isMovingEntry,
    moveEntry: nav.moveEntry,
  });
  const activeDragEntry =
    nav.entries.find((entry) => entry.path === dnd.activeDragPath) ?? null;
  const breadcrumbs = buildBreadcrumbs(nav.currentPath, nav.currentDrive);
  const upDestinationPath =
    breadcrumbs.length > 2 ? breadcrumbs[breadcrumbs.length - 2].path : "";

  return (
    <section className={`${styles.panelContent} ${styles.panelList}`} aria-label="Filesystem panel">
      <h2 className={styles.title}>{isBrowsing ? "Files" : "Drives"}</h2>
      <FilesystemStatusMessages
        isBrowsing={isBrowsing}
        isLoadingDrives={nav.isLoadingDrives}
        isLoadingEntries={nav.isLoadingEntries}
        isMovingEntry={nav.isMovingEntry}
        error={nav.error}
      />

      {!isBrowsing && !nav.isLoadingDrives && !nav.error && (
        <ul className={styles.entryList}>
          {nav.drives.map((drive) => (
            <EntryItem
              key={drive.path}
              label={drive.name}
              meta={drive.path}
              isSelected={nav.selectedPath === drive.path}
              onClick={() => nav.setSelectedPath(drive.path)}
              onDoubleClick={() => nav.selectDrive(drive.path)}
            />
          ))}
        </ul>
      )}

      {isBrowsing && (
        <DndContext
          sensors={dnd.sensors}
          collisionDetection={pointerWithin}
          autoScroll={false}
          onDragStart={dnd.handleDragStart}
          onDragEnd={dnd.handleDragEnd}
          onDragCancel={dnd.handleDragCancel}
        >
          <Breadcrumbs
            currentPath={nav.currentPath}
            currentDrive={nav.currentDrive}
            onSelect={nav.setCurrentPath}
            activeDragPath={dnd.activeDragPath}
            isMovingEntry={nav.isMovingEntry}
            getDropIdForPath={dnd.getBreadcrumbDropId}
          />

          {!nav.isLoadingEntries && !nav.error && (
            <ul className={styles.entryList}>
              <UpEntryDropTarget
                destinationPath={upDestinationPath}
                isSelected={nav.selectedPath === UP_ENTRY_SELECTION_ID}
                isMovingEntry={nav.isMovingEntry}
                activeDragPath={dnd.activeDragPath}
                onClick={() => nav.setSelectedPath(UP_ENTRY_SELECTION_ID)}
                onDoubleClick={nav.goUp}
              />
              {nav.entries.map((entry) => (
                <DraggableFilesystemEntry
                  key={entry.path}
                  entry={entry}
                  isSelected={nav.selectedPath === entry.path}
                  isMovingEntry={nav.isMovingEntry}
                  activeDragPath={dnd.activeDragPath}
                  onClick={() => nav.selectEntry(entry.path)}
                  onDoubleClick={() => nav.openEntry(entry)}
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
