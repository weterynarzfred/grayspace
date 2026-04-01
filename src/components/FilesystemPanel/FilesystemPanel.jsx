import { DragOverlay, useDroppable } from "@dnd-kit/core";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelsDndHandlers } from "../PanelsDndLayer";
import PanelHeader from "../PanelHeader";
import Breadcrumbs, { buildBreadcrumbs } from "./Breadcrumbs";
import DraggableFilesystemEntry from "./DraggableFilesystemEntry";
import EntryItem from "./EntryItem";
import FilesystemStatusMessages from "./FilesystemStatusMessages";
import UpEntryDropTarget from "./UpEntryDropTarget";
import { normalizeFilesystemPaneState } from "./filesystemPaneState";
import useFilesystemDnd from "./hooks/useFilesystemDnd";
import useExternalFilesystemDrag from "./hooks/useExternalFilesystemDrag";
import useFilesystemNavigation from "./hooks/useFilesystemNavigation";
import useFilesystemStatePersistence from "./hooks/useFilesystemStatePersistence";
import useFilesystemThumbnails from "./hooks/useFilesystemThumbnails";
import useFilesystemTree from "./hooks/useFilesystemTree";
import useFilesystemWorkspaceFolders from "./hooks/useFilesystemWorkspaceFolders";
import useVirtualizedEntryWindow from "./hooks/useVirtualizedEntryWindow";
import useExternalPathDrop from "../hooks/useExternalPathDrop";
import { uniqueNonEmptyPaths } from "../../utils/pathSelection";
import { useNotificationCenter } from "../../notifications/notificationCenter";
import isEditableKeyboardTarget from "../../utils/isEditableKeyboardTarget";
import styles from "./FilesystemPanel.module.scss";

const UP_ENTRY_SELECTION_ID = "__up__";
const ENTRY_WINDOWING_THRESHOLD = 200;
const ENTRY_ROW_HEIGHT_PX = 29;

function normalizePathForComparison(path) {
  if (typeof path !== "string" || !path.trim()) return "";
  return path
    .trim()
    .replace(/[\\/]+$/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

function isPathInsideRoot(path, rootPath) {
  const normalizedPath = normalizePathForComparison(path);
  const normalizedRootPath = normalizePathForComparison(rootPath);
  if (!normalizedRootPath) return false;
  return normalizedPath === normalizedRootPath || normalizedPath.startsWith(`${normalizedRootPath}/`);
}

function resolveExternalDropDestinationFromPoint(clientPosition, fallbackPath) {
  if (
    !clientPosition
    || typeof document === "undefined"
    || typeof document.elementFromPoint !== "function"
  ) {
    return fallbackPath;
  }
  const hoveredElement = document.elementFromPoint(clientPosition.x, clientPosition.y);
  const dropTargetElement = hoveredElement?.closest?.("[data-drop-destination-path]");
  const destinationPath = dropTargetElement?.getAttribute("data-drop-destination-path") ?? "";
  return destinationPath || fallbackPath;
}

function FilesystemPanel({
  tabId = "",
  paneId = "",
  panelType = "Filesystem",
  tabWorkspaceRoot = "",
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
  const [expandedPaths, setExpandedPaths] = useState(initialFilesystemStateRef.current.expandedPaths);
  const [externalDropDestinationPath, setExternalDropDestinationPath] = useState("");
  const nav = useFilesystemNavigation(initialFilesystemStateRef.current, {
    tabId,
    tabWorkspaceRoot,
  });
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
    expandedPaths,
  });
  const isBrowsing = currentPath !== "";
  const isEntryOperationInProgress = isMovingEntry || isDeletingEntries || isImportingExternal;
  const isExternalDragEnabled = isBrowsing && !isEntryOperationInProgress;
  const {
    treeRows,
    toggleDirectoryExpanded,
  } = useFilesystemTree({
    currentPath,
    rootEntries: entries,
    initialExpandedPaths: initialFilesystemStateRef.current.expandedPaths,
    onExpandedPathsChange: setExpandedPaths,
  });
  const flattenedEntries = useMemo(() => treeRows.map((row) => row.entry), [treeRows]);
  const entryParentByPath = useMemo(() => {
    const byPath = {};
    treeRows.forEach((row) => {
      byPath[row.entry.path] = row.parentPath;
    });
    return byPath;
  }, [treeRows]);
  const flattenedEntryPaths = useMemo(() => flattenedEntries.map((entry) => entry.path), [flattenedEntries]);
  const flattenedEntryPathSet = useMemo(() => new Set(flattenedEntryPaths), [flattenedEntryPaths]);
  const selectedEntryPaths = useMemo(() => (
    selectedPaths.filter((path) => flattenedEntryPathSet.has(path))
  ), [flattenedEntryPathSet, selectedPaths]);
  const dnd = useFilesystemDnd({
    paneId,
    entries: flattenedEntries,
    entryParentByPath,
    selectedPaths: selectedEntryPaths,
    isMovingEntry: isEntryOperationInProgress,
    moveEntries,
    copyEntries,
  });
  const handleExternalDragStateChange = useCallback((dragState) => {
    if (!isExternalDragEnabled) return setExternalDropDestinationPath("");
    const clientPosition = dragState?.clientPosition ?? null;
    if (dragState?.isInsidePanel !== true || !clientPosition) return setExternalDropDestinationPath("");
    setExternalDropDestinationPath(resolveExternalDropDestinationFromPoint(clientPosition, currentPath));
  }, [currentPath, isExternalDragEnabled]);
  const handleExternalDropPaths = useCallback(async (droppedPaths, context = {}) => {
    const destinationDir = resolveExternalDropDestinationFromPoint(
      context.clientPosition ?? null,
      currentPath,
    );
    const matchingInternalDragPaths = dnd.consumeMatchingExternalDragSourcePaths(droppedPaths);
    setExternalDropDestinationPath("");
    if (matchingInternalDragPaths.length > 0) {
      await moveEntries(matchingInternalDragPaths, destinationDir);
      return;
    }

    await importExternalPaths(droppedPaths, destinationDir);
  }, [currentPath, dnd, importExternalPaths, moveEntries]);
  const { isExternalDragOver } = useExternalPathDrop({
    panelRef,
    isEnabled: isExternalDragEnabled,
    onDropPaths: handleExternalDropPaths,
    onExternalDragStateChange: handleExternalDragStateChange,
  });
  useExternalFilesystemDrag({
    dragPaths: dnd.externalDragPaths,
    isEnabled: isExternalDragEnabled,
    onExternalDragStart: dnd.markExternalDragStart,
    onExternalDragError: dnd.clearExternalDragStart,
  });
  usePanelsDndHandlers({
    onDragStart: dnd.handleDragStart,
    onDragOver: dnd.handleDragOver,
    onDragEnd: dnd.handleDragEnd,
    onDragCancel: dnd.handleDragCancel,
  });
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedEntryPathSet = useMemo(
    () => new Set(selectedEntryPaths),
    [selectedEntryPaths],
  );
  const internalActiveDragPathSet = useMemo(() => new Set(dnd.activeDragPaths), [dnd.activeDragPaths]);
  const hasExternalDropDestination = Boolean(externalDropDestinationPath);
  const effectiveActiveDragPaths = hasExternalDropDestination
    ? ["__external__"]
    : dnd.activeDragPaths;
  const effectiveActiveDragPathSet = useMemo(
    () => new Set(effectiveActiveDragPaths),
    [effectiveActiveDragPaths],
  );
  const effectiveActiveDropDestinationPath = externalDropDestinationPath || dnd.activeDropDestinationPath;
  const isInternalDragActive = dnd.activeDragPaths.length > 0;
  const activeDragEntries = useMemo(() => (
    flattenedEntries.filter((entry) => internalActiveDragPathSet.has(entry.path))
  ), [flattenedEntries, internalActiveDragPathSet]);
  const isEntryWindowingEnabled = isBrowsing && treeRows.length >= ENTRY_WINDOWING_THRESHOLD;
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
  const visibleEntries = useMemo(() => renderedRows.map((row) => row.entry), [renderedRows]);
  const { thumbnailSrcByPath } = useFilesystemThumbnails({
    currentPath,
    entries: flattenedEntries,
    visibleEntries,
  });
  const breadcrumbs = buildBreadcrumbs(currentPath, currentDrive);
  const workspaceFolderPathSet = useFilesystemWorkspaceFolders({
    entries: flattenedEntries,
    paths: breadcrumbs
      .map((crumb) => crumb.path)
      .filter((path) => typeof path === "string" && path),
  });
  const activeDragEntry = activeDragEntries[0] ?? null;
  const upDestinationPath = breadcrumbs.length > 2 ? breadcrumbs[breadcrumbs.length - 2].path : "";
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
    openEntry(entry, {
      isWorkspaceFolder: workspaceFolderPathSet.has(entry.path),
    });
  }, [openEntry, workspaceFolderPathSet]);
  const canLeaveWorkspaceWithoutConfirm = useCallback((nextPath) => {
    if (!tabWorkspaceRoot) return true;
    return isPathInsideRoot(nextPath, tabWorkspaceRoot);
  }, [tabWorkspaceRoot]);
  const confirmWorkspaceExitIfNeeded = useCallback(async (nextPath) => {
    if (canLeaveWorkspaceWithoutConfirm(nextPath)) return true;
    const shouldLeaveWorkspace = await openConfirm({
      title: "Leave workspace?",
      message: "This will clear workspace context for this tab.",
      tone: "warning",
      confirmLabel: "Leave workspace",
      cancelLabel: "Stay",
      autoOpen: true,
    });
    return shouldLeaveWorkspace;
  }, [canLeaveWorkspaceWithoutConfirm, openConfirm]);
  const handleBreadcrumbSelect = useCallback(async (nextPath) => {
    if (!await confirmWorkspaceExitIfNeeded(nextPath)) return;
    navigateToPath(nextPath);
  }, [confirmWorkspaceExitIfNeeded, navigateToPath]);
  const handleGoUpDoubleClick = useCallback(async () => {
    if (!await confirmWorkspaceExitIfNeeded(upDestinationPath)) return;
    navigateToPath(upDestinationPath);
  }, [confirmWorkspaceExitIfNeeded, navigateToPath, upDestinationPath]);
  const handleEntryMiddleClick = useCallback((entry, event) => {
    if (!entry?.is_dir || event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    openEntry(entry, {
      forceOpenInNewTab: true,
      isWorkspaceFolder: workspaceFolderPathSet.has(entry.path),
    });
  }, [openEntry, workspaceFolderPathSet]);

  useEffect(() => {
    onCurrentPathChange?.(currentPath);
  }, [currentPath, onCurrentPathChange]);

  useEffect(() => {
    setExternalDropDestinationPath("");
  }, [currentPath]);

  useEffect(() => {
    if (!isExternalDragEnabled) setExternalDropDestinationPath("");
  }, [isExternalDragEnabled]);

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
    className={`${styles.panelContent} ${isPanelDropOver && isInternalDragActive ? styles.panelDropTarget : ""} ${isExternalDragOver ? styles.externalDropTarget : ""}`}
    aria-label="Filesystem panel"
    data-drop-destination-path={currentPath || undefined}
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
            onSelect={handleBreadcrumbSelect}
            activeDragPaths={effectiveActiveDragPaths}
            isMovingEntry={isMovingEntry}
            getDropIdForPath={dnd.getBreadcrumbDropId}
            workspaceFolderPathSet={workspaceFolderPathSet}
          />

          {!isLoadingEntries && !error && (
            <ul className={styles.entryList}>
              <UpEntryDropTarget
                destinationPath={upDestinationPath}
                isSelected={selectedPathSet.has(UP_ENTRY_SELECTION_ID)}
                isMovingEntry={isEntryOperationInProgress}
                activeDragPaths={effectiveActiveDragPaths}
                onClick={() => setSelectedPath(UP_ENTRY_SELECTION_ID)}
                onDoubleClick={handleGoUpDoubleClick}
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
                  dropDestinationPath={row.entry.is_dir ? row.entry.path : row.parentPath}
                  selectedEntryPaths={selectedEntryPaths}
                  isSelectedForDrag={selectedEntryPathSet.has(row.entry.path)}
                  isSelected={selectedPathSet.has(row.entry.path)}
                  isMovingEntry={isEntryOperationInProgress}
                  activeDragPathSet={effectiveActiveDragPathSet}
                  activeDropDestinationPath={effectiveActiveDropDestinationPath}
                  isWorkspaceFolder={workspaceFolderPathSet.has(row.entry.path)}
                  thumbnailSrc={thumbnailSrcByPath[row.entry.path] ?? ""}
                  nestingDepth={row.depth}
                  isExpanded={row.isExpanded}
                  onToggleExpand={row.entry.is_dir ? () => toggleDirectoryExpanded(row.entry.path) : undefined}
                  onEntryClick={handleEntryClick}
                  onEntryDoubleClick={handleEntryDoubleClick}
                  onEntryMiddleClick={handleEntryMiddleClick}
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
