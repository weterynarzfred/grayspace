import { DragOverlay, useDroppable } from "@dnd-kit/core";
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
import { uniqueNonEmptyPaths } from "../../utils/pathSelection";
import { useNotificationCenter } from "../../notifications/notificationCenter";
import isEditableKeyboardTarget from "../../utils/isEditableKeyboardTarget";
import styles from "./FilesystemPanel.module.scss";

const UP_ENTRY_SELECTION_ID = "__up__";

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
  const {
    currentDrive,
    currentPath,
    selectedPaths,
    selectedEntryPaths,
    entries,
    drives,
    isLoadingDrives,
    isLoadingEntries,
    isMovingEntry,
    isDeletingEntries,
    isImportingExternal,
    error,
    setSelectedPath,
    selectDrive,
    navigateToPath,
    goUp,
    selectEntry,
    openEntry,
    moveEntries,
    copyEntries,
    deleteEntries,
    importExternalPaths,
  } = nav;
  const { handlePanelListScroll } = useFilesystemStatePersistence({
    tabId,
    paneId,
    onFilesystemStateChange,
    panelListRef,
    initialFilesystemState: initialFilesystemStateRef.current,
    currentDrive,
    currentPath,
    selectedPaths,
  });
  const isBrowsing = currentPath !== "";
  const isEntryOperationInProgress =
    isMovingEntry
    || isDeletingEntries
    || isImportingExternal;
  const isExternalDragEnabled = isBrowsing && !isEntryOperationInProgress;
  const dnd = useFilesystemDnd({
    paneId,
    entries,
    selectedPaths: selectedEntryPaths,
    currentPath,
    isMovingEntry: isEntryOperationInProgress,
    moveEntries,
    copyEntries,
  });
  const { isExternalDragOver } = useExternalFilesystemDrop({
    panelRef,
    isEnabled: isExternalDragEnabled,
    onDropPaths: importExternalPaths,
  });
  useExternalFilesystemDrag({
    dragPaths: dnd.externalDragPaths,
    isEnabled: isExternalDragEnabled,
    onExternalDragStart: dnd.markExternalDragStart,
    onExternalDragError: dnd.clearExternalDragStart,
  });
  usePanelsDndHandlers({
    onDragStart: dnd.handleDragStart,
    onDragEnd: dnd.handleDragEnd,
    onDragCancel: dnd.handleDragCancel,
  });
  const activeDragEntries = entries.filter(
    (entry) => dnd.activeDragPaths.includes(entry.path),
  );
  const activeDragEntry = activeDragEntries[0] ?? null;
  const breadcrumbs = buildBreadcrumbs(currentPath, currentDrive);
  const upDestinationPath =
    breadcrumbs.length > 2 ? breadcrumbs[breadcrumbs.length - 2].path : "";
  const {
    isOver: isPanelDropOver,
    setNodeRef: setPanelDropNodeRef,
  } = useDroppable({
    id: dnd.getPanelDropId(currentPath),
    disabled: !isBrowsing || isEntryOperationInProgress,
    data: {
      kind: "panel",
      path: currentPath,
      isDirectory: true,
    },
  });
  const setPanelNodeRef = useCallback((node) => {
    panelRef.current = node;
    setPanelDropNodeRef(node);
  }, [setPanelDropNodeRef]);
  const emitTabSelectedFiles = useCallback((nextSelectedPaths) => {
    if (!tabId) return;
    const normalizedPaths = uniqueNonEmptyPaths(nextSelectedPaths);
    onTabSelectedFilesChange?.({
      selectedPaths: normalizedPaths,
    });
  }, [onTabSelectedFilesChange, tabId]);

  useEffect(() => {
    onCurrentPathChange?.(currentPath);
  }, [currentPath, onCurrentPathChange]);

  const handleDeleteSelectedEntries = useCallback(async () => {
    const selectedPaths = uniqueNonEmptyPaths(selectedEntryPaths);
    if (!isBrowsing || selectedPaths.length === 0 || isEntryOperationInProgress) return;

    const selectedEntries = entries.filter((entry) => selectedPaths.includes(entry.path));
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
    entries,
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
    ref={setPanelNodeRef}
    className={`${styles.panelContent} ${isPanelDropOver ? styles.panelDropTarget : ""} ${isExternalDragOver ? styles.externalDropTarget : ""}`}
    aria-label="Filesystem panel"
    onKeyDown={handlePanelKeyDown}
  >
    <PanelHeader
      panelType={panelType}
      onPanelTypeChange={onPanelTypeChange}
    >
      <FilesystemStatusMessages
        isBrowsing={isBrowsing}
        isLoadingDrives={isLoadingDrives}
        isLoadingEntries={isLoadingEntries}
        isMovingEntry={isMovingEntry}
        isDeletingEntries={isDeletingEntries}
        isImportingExternal={isImportingExternal}
        error={error}
      />
    </PanelHeader>
    <div
      ref={panelListRef}
      className={styles.panelList}
      onScroll={handlePanelListScroll}
      data-testid="filesystem-panel-list"
    >

      {!isBrowsing && !isLoadingDrives && !error && (
        <ul className={styles.entryList}>
          {drives.map((drive) => <EntryItem
            key={drive.path}
            label={drive.name}
            meta={drive.path}
            isSelected={selectedPaths.includes(drive.path)}
            onClick={() => setSelectedPath(drive.path)}
            onDoubleClick={() => selectDrive(drive.path)}
          />)}
        </ul>
      )}

      {isBrowsing && (
        <>
          <Breadcrumbs
            currentPath={currentPath}
            currentDrive={currentDrive}
            onSelect={navigateToPath}
            activeDragPaths={dnd.activeDragPaths}
            isMovingEntry={isMovingEntry}
            getDropIdForPath={dnd.getBreadcrumbDropId}
          />

          {!isLoadingEntries && !error && (
            <ul className={styles.entryList}>
              <UpEntryDropTarget
                destinationPath={upDestinationPath}
                isSelected={selectedPaths.includes(UP_ENTRY_SELECTION_ID)}
                isMovingEntry={isEntryOperationInProgress}
                activeDragPaths={dnd.activeDragPaths}
                onClick={() => setSelectedPath(UP_ENTRY_SELECTION_ID)}
                onDoubleClick={goUp}
              />
              {entries.map((entry) => <DraggableFilesystemEntry
                key={entry.path}
                paneId={paneId}
                entry={entry}
                dragPaths={
                  selectedEntryPaths.includes(entry.path)
                    ? selectedEntryPaths
                    : [entry.path]
                }
                isSelected={selectedPaths.includes(entry.path)}
                isMovingEntry={isEntryOperationInProgress}
                activeDragPaths={dnd.activeDragPaths}
                onClick={(event) => {
                  const nextSelectedEntryPaths = selectEntry(entry.path, {
                    additive: event.metaKey || event.ctrlKey,
                    range: event.shiftKey,
                  });
                  emitTabSelectedFiles(nextSelectedEntryPaths);
                }}
                onDoubleClick={() => openEntry(entry)}
              />)}
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
