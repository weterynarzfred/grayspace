import { DragOverlay, useDroppable } from "@dnd-kit/core";
import { Fragment, useCallback, useEffect, useMemo, useRef } from "react";
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
import useFilesystemThumbnails from "./hooks/useFilesystemThumbnails";
import useFilesystemTree from "./hooks/useFilesystemTree";
import useVirtualizedEntryWindow from "./hooks/useVirtualizedEntryWindow";
import { uniqueNonEmptyPaths } from "../../utils/pathSelection";
import { useNotificationCenter } from "../../notifications/notificationCenter";
import isEditableKeyboardTarget from "../../utils/isEditableKeyboardTarget";
import styles from "./FilesystemPanel.module.scss";

const UP_ENTRY_SELECTION_ID = "__up__";
const ENTRY_WINDOWING_THRESHOLD = 200;
const ENTRY_ROW_HEIGHT_PX = 29;

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
  const entryWindowAnchorRef = useRef(null);
  const initialFilesystemStateRef = useRef(normalizeFilesystemPaneState(filesystemState));
  const nav = useFilesystemNavigation(initialFilesystemStateRef.current);
  const { openConfirm } = useNotificationCenter();
  const {
    currentDrive,
    currentPath,
    selectedPaths,
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
  const {
    treeRows,
    toggleDirectoryExpanded,
  } = useFilesystemTree({
    currentPath,
    rootEntries: entries,
  });
  const flattenedEntries = useMemo(
    () => treeRows.map((row) => row.entry),
    [treeRows],
  );
  const flattenedEntryPaths = useMemo(
    () => flattenedEntries.map((entry) => entry.path),
    [flattenedEntries],
  );
  const flattenedEntryPathSet = useMemo(
    () => new Set(flattenedEntryPaths),
    [flattenedEntryPaths],
  );
  const selectedEntryPaths = useMemo(
    () => selectedPaths.filter((path) => flattenedEntryPathSet.has(path)),
    [flattenedEntryPathSet, selectedPaths],
  );
  const dnd = useFilesystemDnd({
    paneId,
    entries: flattenedEntries,
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
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedEntryPathSet = useMemo(
    () => new Set(selectedEntryPaths),
    [selectedEntryPaths],
  );
  const activeDragPathSet = useMemo(() => new Set(dnd.activeDragPaths), [dnd.activeDragPaths]);
  const activeDragEntries = useMemo(() => flattenedEntries.filter(
    (entry) => activeDragPathSet.has(entry.path),
  ), [activeDragPathSet, flattenedEntries]);
  const isEntryWindowingEnabled =
    isBrowsing && treeRows.length >= ENTRY_WINDOWING_THRESHOLD;
  const {
    startIndex: virtualStartIndex,
    endIndex: virtualEndIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    scheduleRecompute: scheduleEntryWindowRecompute,
  } = useVirtualizedEntryWindow({
    itemCount: treeRows.length,
    rowHeightPx: ENTRY_ROW_HEIGHT_PX,
    isEnabled: isEntryWindowingEnabled,
    scrollContainerRef: panelListRef,
    listStartAnchorRef: entryWindowAnchorRef,
  });
  const visibleRows = useMemo(() => treeRows.slice(virtualStartIndex, virtualEndIndex), [
    treeRows,
    virtualEndIndex,
    virtualStartIndex,
  ]);
  const renderedRows = isEntryWindowingEnabled ? visibleRows : treeRows;
  const visibleEntries = useMemo(
    () => renderedRows.map((row) => row.entry),
    [renderedRows],
  );
  const { thumbnailSrcByPath } = useFilesystemThumbnails({
    currentPath,
    entries: flattenedEntries,
    visibleEntries,
  });
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
  const handleEntryClick = useCallback((entryPath, event) => {
    const nextSelectedEntryPaths = selectEntry(entryPath, {
      additive: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
      entryPaths: flattenedEntryPaths,
    });
    emitTabSelectedFiles(nextSelectedEntryPaths);
  }, [emitTabSelectedFiles, flattenedEntryPaths, selectEntry]);
  const handleEntryDoubleClick = useCallback((entry) => {
    openEntry(entry);
  }, [openEntry]);

  useEffect(() => {
    onCurrentPathChange?.(currentPath);
  }, [currentPath, onCurrentPathChange]);

  const handleDeleteSelectedEntries = useCallback(async () => {
    const selectedPaths = uniqueNonEmptyPaths(selectedEntryPaths);
    if (!isBrowsing || selectedPaths.length === 0 || isEntryOperationInProgress) return;

    const selectedEntries = flattenedEntries.filter((entry) => selectedPaths.includes(entry.path));
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
    flattenedEntries,
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
  const handlePanelScroll = useCallback((event) => {
    handlePanelListScroll(event);
    scheduleEntryWindowRecompute();
  }, [handlePanelListScroll, scheduleEntryWindowRecompute]);

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
      onScroll={handlePanelScroll}
      data-testid="filesystem-panel-list"
    >

      {!isBrowsing && !isLoadingDrives && !error && (
        <ul className={styles.entryList}>
          {drives.map((drive) => <EntryItem
            key={drive.path}
            label={drive.name}
            meta={drive.path}
            isSelected={selectedPathSet.has(drive.path)}
            isDirectory
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
                isSelected={selectedPathSet.has(UP_ENTRY_SELECTION_ID)}
                isMovingEntry={isEntryOperationInProgress}
                activeDragPaths={dnd.activeDragPaths}
                onClick={() => setSelectedPath(UP_ENTRY_SELECTION_ID)}
                onDoubleClick={goUp}
              />
              <li
                ref={entryWindowAnchorRef}
                className={styles.windowingAnchor}
                aria-hidden
              />
              {isEntryWindowingEnabled && topSpacerHeight > 0 && (
                <li
                  className={styles.windowingSpacer}
                  style={{ height: `${topSpacerHeight}px` }}
                  aria-hidden
                />
              )}
              {renderedRows.map((row) => <Fragment key={row.entry.path}>
                <DraggableFilesystemEntry
                  paneId={paneId}
                  entry={row.entry}
                  selectedEntryPaths={selectedEntryPaths}
                  isSelectedForDrag={selectedEntryPathSet.has(row.entry.path)}
                  isSelected={selectedPathSet.has(row.entry.path)}
                  isMovingEntry={isEntryOperationInProgress}
                  activeDragPathSet={activeDragPathSet}
                  thumbnailSrc={thumbnailSrcByPath[row.entry.path] ?? ""}
                  nestingDepth={row.depth}
                  isExpanded={row.isExpanded}
                  onToggleExpand={row.entry.is_dir ? () => toggleDirectoryExpanded(row.entry.path) : undefined}
                  onEntryClick={handleEntryClick}
                  onEntryDoubleClick={handleEntryDoubleClick}
                />
                {row.isLoadingChildren && (
                  <EntryItem
                    label="Loading..."
                    meta=""
                    nestingDepth={row.depth + 1}
                  />
                )}
              </Fragment>)}
              {isEntryWindowingEnabled && bottomSpacerHeight > 0 && (
                <li
                  className={styles.windowingSpacer}
                  style={{ height: `${bottomSpacerHeight}px` }}
                  aria-hidden
                />
              )}
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
