import { useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PanelHeader from "../PanelHeader";
import { buildBreadcrumbs } from "./Breadcrumbs";
import FilesystemPanelListContent from "./FilesystemPanelListContent";
import FilesystemStatusMessages from "./FilesystemStatusMessages";
import {
  FILESYSTEM_THUMBNAIL_SIZE_STEPS,
  normalizeFilesystemPaneState,
} from "./filesystemPaneState";
import {
  isPathInsideRoot,
} from "./filesystemPanelUtils";
import useFilesystemNavigation from "./hooks/useFilesystemNavigation";
import useFilesystemPanelInteractions from "./hooks/useFilesystemPanelInteractions";
import useFilesystemStatePersistence from "./hooks/useFilesystemStatePersistence";
import useFilesystemThumbnails from "./hooks/useFilesystemThumbnails";
import useFilesystemTree from "./hooks/useFilesystemTree";
import useFilesystemWorkspaceFolders from "./hooks/useFilesystemWorkspaceFolders";
import useVirtualizedEntryWindow from "./hooks/useVirtualizedEntryWindow";
import useFilesystemPanelLoadMore from "./hooks/useFilesystemPanelLoadMore";
import { useNotificationCenter } from "../../notifications/notificationCenter";
import styles from "./FilesystemPanel.module.scss";

const UP_ENTRY_SELECTION_ID = "__up__";
const ENTRY_WINDOWING_THRESHOLD = 200;
const THUMBNAIL_SIZE_TOGGLE_TITLE = "Toggle icon/thumbnail size";

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
  const entryWindowAnchorRef = useRef(null);
  const onCurrentPathChangeRef = useRef(onCurrentPathChange);
  const initialFilesystemStateRef = useRef(normalizeFilesystemPaneState(filesystemState));
  const [expandedPaths, setExpandedPaths] = useState(initialFilesystemStateRef.current.expandedPaths);
  const [thumbnailSizePx, setThumbnailSizePx] = useState(
    initialFilesystemStateRef.current.thumbnailSizePx,
  );
  const entryRowHeightPx = thumbnailSizePx;
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
    isLoadingMoreEntries,
    hasMoreEntries,
    totalEntriesCount,
    isMovingEntry,
    isDeletingEntries,
    isImportingExternal,
    error,
    setSelectedPath,
    selectDrive,
    navigateToPath,
    loadMoreEntries,
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
    panelListRef: panelRef,
    initialFilesystemState: initialFilesystemStateRef.current,
    currentDrive,
    currentPath,
    selectedPaths,
    expandedPaths,
    thumbnailSizePx,
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
  const totalRootEntryCount = Math.max(totalEntriesCount, entries.length);
  const unresolvedRootEntryCount = Math.max(0, totalRootEntryCount - entries.length);
  const virtualRowCount = treeRows.length + unresolvedRootEntryCount;
  const isEntryWindowingEnabled = isBrowsing && virtualRowCount >= ENTRY_WINDOWING_THRESHOLD;
  const {
    startIndex: virtualStartIndex,
    endIndex: virtualEndIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    scheduleRecompute: scheduleEntryWindowRecompute,
  } = useVirtualizedEntryWindow({
    itemCount: virtualRowCount,
    rowHeightPx: entryRowHeightPx,
    isEnabled: isEntryWindowingEnabled,
    scrollContainerRef: panelRef,
    listStartAnchorRef: entryWindowAnchorRef,
  });
  const visibleRows = useMemo(() => {
    const visibleStart = Math.min(virtualStartIndex, treeRows.length);
    const visibleEnd = Math.min(virtualEndIndex, treeRows.length);
    return treeRows.slice(visibleStart, visibleEnd);
  }, [treeRows, virtualEndIndex, virtualStartIndex]);
  const renderedRows = isEntryWindowingEnabled ? visibleRows : treeRows;
  const visibleEntries = useMemo(() => renderedRows.map((row) => row.entry), [renderedRows]);
  const { thumbnailSrcByPath } = useFilesystemThumbnails({
    currentPath,
    visibleEntries,
    thumbnailSizePx,
  });
  const breadcrumbs = buildBreadcrumbs(currentPath, currentDrive);
  const workspaceFolderPathSet = useFilesystemWorkspaceFolders({
    entries: visibleEntries,
    paths: breadcrumbs
      .map((crumb) => crumb.path)
      .filter((path) => typeof path === "string" && path),
  });
  const {
    selectedEntryPaths,
    selectedPathSet,
    selectedEntryPathSet,
    dnd,
    effectiveActiveDragPaths,
    effectiveActiveDragPathSet,
    effectiveActiveDropDestinationPath,
    isInternalDragActive,
    activeDragEntries,
    activeDragEntry,
    handleEntryClick,
    handleEntryDoubleClick,
    handleEntryMiddleClick,
    handlePanelKeyDown,
    isExternalDragOver,
  } = useFilesystemPanelInteractions({
    tabId,
    paneId,
    panelRef,
    currentPath,
    selectedPaths,
    treeRows,
    isBrowsing,
    isEntryOperationInProgress,
    isExternalDragEnabled,
    selectEntry,
    openEntry,
    moveEntries,
    copyEntries,
    importExternalPaths,
    deleteEntries,
    onTabSelectedFilesChange,
    workspaceFolderPathSet,
    openConfirm,
  });
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

  useEffect(() => {
    onCurrentPathChangeRef.current = onCurrentPathChange;
  }, [onCurrentPathChange]);

  useEffect(() => {
    onCurrentPathChangeRef.current?.(currentPath);
  }, [currentPath]);
  const { handlePanelScroll } = useFilesystemPanelLoadMore({
    panelRef,
    handlePanelListScroll,
    scheduleEntryWindowRecompute,
    isEntryWindowingEnabled,
    hasMoreEntries,
    isLoadingEntries,
    isLoadingMoreEntries,
    loadMoreEntries,
    isBrowsing,
    treeRowsCount: treeRows.length,
    virtualEndIndex,
  });
  const handleToggleThumbnailSize = useCallback(() => {
    setThumbnailSizePx((previousSize) => {
      const currentIndex = FILESYSTEM_THUMBNAIL_SIZE_STEPS.indexOf(previousSize);
      const nextIndex = currentIndex >= 0
        ? (currentIndex + 1) % FILESYSTEM_THUMBNAIL_SIZE_STEPS.length
        : 0;
      return FILESYSTEM_THUMBNAIL_SIZE_STEPS[nextIndex];
    });
  }, []);
  const panelStyle = useMemo(() => ({
    "--entry-thumbnail-size": `${thumbnailSizePx}px`,
    "--entry-row-height": `${entryRowHeightPx}px`,
  }), [entryRowHeightPx, thumbnailSizePx]);

  return <section
    ref={setPanelNodeRef}
    className={`${styles.panelContent} ${isPanelDropOver && isInternalDragActive ? styles.panelDropTarget : ""} ${isExternalDragOver ? styles.externalDropTarget : ""}`}
    style={panelStyle}
    aria-label="Filesystem panel"
    data-testid="filesystem-panel-scroll-container"
    data-drop-destination-path={currentPath || undefined}
    onKeyDown={handlePanelKeyDown}
    onScroll={handlePanelScroll}
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
      <button
        type="button"
        className={styles.thumbnailSizeToggle}
        onClick={handleToggleThumbnailSize}
        title={THUMBNAIL_SIZE_TOGGLE_TITLE}
        aria-label={`Toggle icon and thumbnail size. Current: ${thumbnailSizePx}px`}
      >{thumbnailSizePx}px</button>
    </PanelHeader>
    <FilesystemPanelListContent
      paneId={paneId}
      browse={{
        isBrowsing,
        isLoadingDrives,
        isLoadingEntries,
        error,
        isEntryOperationInProgress,
      }}
      drives={{
        items: drives,
        selectedPathSet,
        onSelect: setSelectedPath,
        onOpen: selectDrive,
      }}
      breadcrumbs={{
        currentPath,
        currentDrive,
        onSelect: handleBreadcrumbSelect,
        activeDragPaths: effectiveActiveDragPaths,
        isMovingEntry,
        getDropIdForPath: dnd.getBreadcrumbDropId,
        workspaceFolderPathSet,
      }}
      upEntry={{
        destinationPath: upDestinationPath,
        isSelected: selectedPathSet.has(UP_ENTRY_SELECTION_ID),
        onSelect: () => setSelectedPath(UP_ENTRY_SELECTION_ID),
        onOpen: handleGoUpDoubleClick,
      }}
      windowing={{
        entryWindowAnchorRef,
        isEnabled: isEntryWindowingEnabled,
        topSpacerHeight,
        bottomSpacerHeight,
      }}
      entries={{
        rows: renderedRows,
        selectedEntryPaths,
        selectedEntryPathSet,
        activeDragPathSet: effectiveActiveDragPathSet,
        activeDropDestinationPath: effectiveActiveDropDestinationPath,
        thumbnailSrcByPath,
        onToggleDirectoryExpanded: toggleDirectoryExpanded,
        onEntryClick: handleEntryClick,
        onEntryDoubleClick: handleEntryDoubleClick,
        onEntryMiddleClick: handleEntryMiddleClick,
      }}
      drag={{
        activeEntry: activeDragEntry,
        activeEntries: activeDragEntries,
      }}
    />
  </section>;
}

export default FilesystemPanel;
