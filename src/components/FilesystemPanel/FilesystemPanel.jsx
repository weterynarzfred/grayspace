import { DragOverlay } from "@dnd-kit/core";
import { useCallback, useEffect, useRef } from "react";
import { usePanelsDndHandlers } from "../PanelsDndLayer";
import PanelHeader from "../PanelHeader";
import Breadcrumbs, { buildBreadcrumbs } from "./Breadcrumbs";
import DraggableFilesystemEntry from "./DraggableFilesystemEntry";
import EntryItem from "./EntryItem";
import FilesystemStatusMessages from "./FilesystemStatusMessages";
import UpEntryDropTarget from "./UpEntryDropTarget";
import { normalizeFilesystemPaneState } from "./filesystemPaneState";
import useFilesystemDnd from "./hooks/useFilesystemDnd";
import useExternalFilesystemDrop from "./hooks/useExternalFilesystemDrop";
import useExternalFilesystemDrag from "./hooks/useExternalFilesystemDrag";
import useFilesystemNavigation from "./hooks/useFilesystemNavigation";
import useFilesystemStatePersistence from "./hooks/useFilesystemStatePersistence";
import { uniqueNonEmptyPaths } from "./pathSelection";
import { useNotificationCenter } from "../../notifications/notificationCenter";
import styles from "./FilesystemPanel.module.scss";

const UP_ENTRY_SELECTION_ID = "__up__";

function isEditableKeyboardTarget(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable
    || tagName === "input"
    || tagName === "textarea"
    || tagName === "select"
  );
}

function FilesystemPanel({
  tabId = "",
  paneId = "",
  panelType = "Filesystem",
  onPanelTypeChange = undefined,
  onCurrentPathChange = undefined,
  onFilesystemStateChange = undefined,
  onTabSelectedFilesChange = undefined,
  filesystemState = undefined,
}) {
  const panelRef = useRef(null);
  const panelListRef = useRef(null);
  const initialFilesystemStateRef = useRef(normalizeFilesystemPaneState(filesystemState));
  const nav = useFilesystemNavigation(initialFilesystemStateRef.current);
  const { openConfirm } = useNotificationCenter();
  const { handlePanelListScroll } = useFilesystemStatePersistence({
    tabId,
    paneId,
    onFilesystemStateChange,
    panelListRef,
    initialFilesystemState: initialFilesystemStateRef.current,
    currentDrive: nav.currentDrive,
    currentPath: nav.currentPath,
    selectedPath: nav.selectedPath,
    selectedPaths: nav.selectedPaths,
  });
  const isBrowsing = nav.currentPath !== "";
  const isEntryOperationInProgress =
    nav.isMovingEntry
    || nav.isDeletingEntries
    || nav.isImportingExternal;
  const isExternalDragEnabled = isBrowsing && !isEntryOperationInProgress;
  const dnd = useFilesystemDnd({
    entries: nav.entries,
    selectedPaths: nav.selectedEntryPaths,
    currentPath: nav.currentPath,
    isMovingEntry: isEntryOperationInProgress,
    moveEntries: nav.moveEntries,
  });
  const { isExternalDragOver } = useExternalFilesystemDrop({
    panelRef,
    isEnabled: isExternalDragEnabled,
    onDropPaths: nav.importExternalPaths,
  });
  useExternalFilesystemDrag({
    dragPaths: dnd.activeDragPaths,
    isEnabled: isExternalDragEnabled,
    onExternalDragStart: dnd.markExternalDragStart,
    onExternalDragError: dnd.clearExternalDragStart,
  });
  usePanelsDndHandlers({
    onDragStart: dnd.handleDragStart,
    onDragEnd: dnd.handleDragEnd,
    onDragCancel: dnd.handleDragCancel,
  });
  const activeDragEntries = nav.entries.filter(
    (entry) => dnd.activeDragPaths.includes(entry.path),
  );
  const activeDragEntry = activeDragEntries[0] ?? null;
  const breadcrumbs = buildBreadcrumbs(nav.currentPath, nav.currentDrive);
  const upDestinationPath =
    breadcrumbs.length > 2 ? breadcrumbs[breadcrumbs.length - 2].path : "";
  const selectedEntryPaths = nav.selectedEntryPaths;
  const filesystemEntries = nav.entries;
  const deleteEntries = nav.deleteEntries;

  const emitTabSelectedFiles = useCallback((nextSelectedPaths) => {
    if (typeof onTabSelectedFilesChange !== "function" || !tabId) return;

    const normalizedPaths = uniqueNonEmptyPaths(nextSelectedPaths);
    onTabSelectedFilesChange({
      selectedPath: normalizedPaths[normalizedPaths.length - 1] ?? "",
      selectedPaths: normalizedPaths,
    });
  }, [onTabSelectedFilesChange, tabId]);

  useEffect(() => {
    if (typeof onCurrentPathChange === "function")
      onCurrentPathChange(nav.currentPath);
  }, [nav.currentPath, onCurrentPathChange]);

  const handleDeleteSelectedEntries = useCallback(async () => {
    const selectedPaths = uniqueNonEmptyPaths(selectedEntryPaths);
    if (!isBrowsing || selectedPaths.length === 0 || isEntryOperationInProgress) return;

    const selectedEntries = filesystemEntries.filter((entry) => selectedPaths.includes(entry.path));
    const confirmMessage = selectedEntries.length === 1
      ? `Delete "${selectedEntries[0].name}" permanently?`
      : `Delete ${selectedEntries.length} selected items permanently?`;

    const shouldDelete = await openConfirm({
      title: "Delete selected items?",
      message: confirmMessage,
      tone: "warning",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      autoOpen: true,
    });
    if (!shouldDelete) return;

    try {
      await deleteEntries(selectedPaths);
      emitTabSelectedFiles([]);
    } catch {
      // The hook surfaces user-facing errors via status messages.
    }
  }, [
    emitTabSelectedFiles,
    deleteEntries,
    filesystemEntries,
    isBrowsing,
    isEntryOperationInProgress,
    openConfirm,
    selectedEntryPaths,
  ]);

  const handlePanelKeyDown = useCallback((event) => {
    if (event.key !== "Delete") return;
    if (event.defaultPrevented || event.repeat) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditableKeyboardTarget(event.target)) return;
    if (!isBrowsing || isEntryOperationInProgress || selectedEntryPaths.length === 0) return;

    event.preventDefault();
    void handleDeleteSelectedEntries();
  }, [
    handleDeleteSelectedEntries,
    isBrowsing,
    isEntryOperationInProgress,
    selectedEntryPaths.length,
  ]);

  return <section
    ref={panelRef}
    className={`${styles.panelContent} ${isExternalDragOver ? styles.externalDropTarget : ""}`}
    aria-label="Filesystem panel"
    onKeyDown={handlePanelKeyDown}
  >
    <PanelHeader
      panelType={panelType}
      onPanelTypeChange={onPanelTypeChange}
    >
      <div className={styles.title}>{isBrowsing ? "Files" : "Drives"}</div>
    </PanelHeader>
    <div
      ref={panelListRef}
      className={styles.panelList}
      onScroll={handlePanelListScroll}
      data-testid="filesystem-panel-list"
    >
      <FilesystemStatusMessages
        isBrowsing={isBrowsing}
        isLoadingDrives={nav.isLoadingDrives}
        isLoadingEntries={nav.isLoadingEntries}
        isMovingEntry={nav.isMovingEntry}
        isDeletingEntries={nav.isDeletingEntries}
        isImportingExternal={nav.isImportingExternal}
        error={nav.error}
      />

      {!isBrowsing && !nav.isLoadingDrives && !nav.error && (
        <ul className={styles.entryList}>
          {nav.drives.map((drive) => (
            <EntryItem
              key={drive.path}
              label={drive.name}
              meta={drive.path}
              isSelected={nav.selectedPaths.includes(drive.path)}
              onClick={() => nav.setSelectedPath(drive.path)}
              onDoubleClick={() => nav.selectDrive(drive.path)}
            />
          ))}
        </ul>
      )}

      {isBrowsing && (
        <>
          <Breadcrumbs
            currentPath={nav.currentPath}
            currentDrive={nav.currentDrive}
            onSelect={nav.navigateToPath}
            activeDragPaths={dnd.activeDragPaths}
            isMovingEntry={nav.isMovingEntry}
            getDropIdForPath={dnd.getBreadcrumbDropId}
          />

          {!nav.isLoadingEntries && !nav.error && (
            <ul className={styles.entryList}>
              <UpEntryDropTarget
                destinationPath={upDestinationPath}
                isSelected={nav.selectedPaths.includes(UP_ENTRY_SELECTION_ID)}
                isMovingEntry={isEntryOperationInProgress}
                activeDragPaths={dnd.activeDragPaths}
                onClick={() => nav.setSelectedPath(UP_ENTRY_SELECTION_ID)}
                onDoubleClick={nav.goUp}
              />
              {nav.entries.map((entry) => (
                <DraggableFilesystemEntry
                  key={entry.path}
                  entry={entry}
                  isSelected={nav.selectedPaths.includes(entry.path)}
                  isMovingEntry={isEntryOperationInProgress}
                  activeDragPaths={dnd.activeDragPaths}
                  onClick={(event) => {
                    const selectedEntryPaths = nav.selectEntry(entry.path, {
                      additive: event.metaKey || event.ctrlKey,
                      range: event.shiftKey,
                    });
                    emitTabSelectedFiles(selectedEntryPaths);
                  }}
                  onDoubleClick={() => nav.openEntry(entry)}
                />
              ))}
            </ul>
          )}
          <DragOverlay dropAnimation={null}>
            {activeDragEntry && (
              <div className={styles.dragOverlay}>
                <span className={styles.dragOverlayName}>
                  {activeDragEntries.length > 1
                    ? `${activeDragEntries.length} items`
                    : activeDragEntry.name}
                </span>
                <span className={styles.dragOverlayMeta}>
                  {activeDragEntries.length > 1
                    ? "Move selection"
                    : (activeDragEntry.is_dir ? "Folder" : "File")}
                </span>
              </div>
            )}
          </DragOverlay>
        </>
      )}
    </div>
  </section>;
}

export default FilesystemPanel;
