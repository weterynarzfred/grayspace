import { DragOverlay } from "@dnd-kit/core";
import { Fragment } from "react";
import Breadcrumbs from "./Breadcrumbs";
import DraggableFilesystemEntry from "./DraggableFilesystemEntry";
import EntryItem from "./EntryItem";
import FilesystemDetailsHeader from "./FilesystemDetailsHeader";
import FilesystemPanelFoldableGridContent from "./FilesystemPanelFoldableGridContent";
import FilesystemPanelGridContent from "./FilesystemPanelGridContent";
import { getResultLocation } from "./filesystemPanelUtils";
import styles from "./FilesystemPanel.module.scss";
import { getParentDirectoryPath } from "../../utils/pathWatch";

function describeSearch({ query, status, error, resultCount, skipsFolders }) {
  if (status === "error") return error;
  if (status === "running") return `Searching subfolders for "${query}"... ${resultCount} found`;
  if (status === "truncated") return `Too many matches for "${query}", showing the first ${resultCount}.`;
  if (resultCount === 0) {
    const skippedNote = skipsFolders ? " (skipped folders not searched)" : "";
    return `No results for "${query}" in this folder or its subfolders${skippedNote}.`;
  }
  return `${resultCount} ${resultCount === 1 ? "result" : "results"} for "${query}" in this folder and its subfolders.`;
}

function getDragOverlayMeta(entries, entry) {
  if (entries.length > 1) return "Selection";
  return entry?.is_dir ? "Folder" : "File";
}

export default function FilesystemPanelListContent({
  paneId = "",
  browse = {},
  drives = {},
  breadcrumbs = {},
  windowing = {},
  entries = {},
  drag = {},
  viewType = "folder-tree",
  details = {},
  grid = {},
  foldable = {},
}) {
  const {
    isBrowsing = false,
    isLoadingDrives = false,
    isLoadingEntries = false,
    error = "",
    isEntryOperationInProgress = false,
    unmatchedFilter = "",
    search = null,
  } = browse;
  const {
    items: driveItems = [],
    selectedPathSet = new Set(),
    onSelect: onDriveSelect = undefined,
    onOpen: onDriveOpen = undefined,
    onMiddleClick: onDriveMiddleClick = undefined,
  } = drives;
  const {
    currentPath = "",
    currentDrive = "",
    onSelect: onBreadcrumbSelect = undefined,
    onMiddleClick: onBreadcrumbMiddleClick = undefined,
    onPathSubmit: onBreadcrumbPathSubmit = undefined,
    loadSubfoldersForPath: loadSubfoldersForPath = undefined,
    focusPathInputRequestKey: focusPathInputRequestKey = 0,
    activeDragPaths = [],
    isMovingEntry = false,
    getDropIdForPath: getBreadcrumbDropId = undefined,
    workspaceFolderPathSet = new Set(),
    recentFoldersEntries = [],
    isLoadingRecentFolders = false,
    onSelectRecentFolder = undefined,
  } = breadcrumbs;
  const {
    entryWindowAnchorRef = undefined,
    isEnabled: isEntryWindowingEnabled = false,
    topSpacerHeight = 0,
    bottomSpacerHeight = 0,
  } = windowing;
  const {
    rows: renderedRows = [],
    selectedEntryPaths = [],
    selectedEntryPathSet = new Set(),
    activeDragPathSet = new Set(),
    activeDropDestinationPath = "",
    renamingPath = "",
    thumbnailSrcByPath = {},
    onToggleDirectoryExpanded = undefined,
    onEntryClick = undefined,
    onEntryDoubleClick = undefined,
    onEntryMiddleClick = undefined,
    onEntryContextMenu = undefined,
    onEntryRenameSubmit = undefined,
    onEntryRenameCancel = undefined,
  } = entries;
  const {
    activeEntry: activeDragEntry = null,
    activeEntries: activeDragEntries = [],
    intent: dragIntent = "move",
  } = drag;
  const {
    entries: gridEntries = [],
    selectedPathSet: gridSelectedPathSet = new Set(),
    thumbnailSrcByPath: gridThumbnailSrcByPath = {},
    workspaceFolderPathSet: gridWorkspaceFolderPathSet = new Set(),
    columnCount: gridColumnCount = 1,
    minCellWidthPx: gridMinCellWidthPx = 72,
    previewSizePx: gridPreviewSizePx = 22,
    rowHeightPx: gridRowHeightPx = 62,
    containerRef: gridContainerRef = undefined,
    anchorRef: gridAnchorRef = undefined,
    topSpacerHeight: gridTopSpacerHeight = 0,
    bottomSpacerHeight: gridBottomSpacerHeight = 0,
    isWindowingEnabled: isGridWindowingEnabled = false,
    renamingPath: gridRenamingPath = "",
    onEntryClick: onGridEntryClick = undefined,
    onEntryDoubleClick: onGridEntryDoubleClick = undefined,
    onEntryMiddleClick: onGridEntryMiddleClick = undefined,
    onEntryContextMenu: onGridEntryContextMenu = undefined,
    onEntryRenameSubmit: onGridEntryRenameSubmit = undefined,
    onEntryRenameCancel: onGridEntryRenameCancel = undefined,
  } = grid;
  const dragIntentLabel = dragIntent === "copy" ? "Copy" : "Move";
  const isGridView = viewType === "grid";
  const isFoldableGridView = viewType === "foldable-grid";
  const isDetailsView = viewType === "details";

  return <div
    className={styles.panelList}
    data-testid="filesystem-panel-list"
  >

    {!isBrowsing && !isLoadingDrives && (
      <ul className={styles.entryList}>
        {driveItems.map(drive => <EntryItem
          key={drive.path}
          label={drive.name}
          meta={drive.path}
          isSelected={selectedPathSet.has(drive.path)}
          isDirectory
          contextKind="folder"
          contextId={drive.path}
          contextLabel={drive.name}
          contextPath={drive.path}
          contextScope="drive-entry"
          contextPaneId={paneId}
          onClick={() => onDriveSelect?.(drive.path)}
          onDoubleClick={() => onDriveOpen?.(drive.path)}
          onAuxClick={(event) => onDriveMiddleClick?.(drive.path, event)}
        />)}
      </ul>
    )}

    {isBrowsing && <>
      <Breadcrumbs
        paneId={paneId}
        currentPath={currentPath}
        currentDrive={currentDrive}
        onSelect={onBreadcrumbSelect}
        onMiddleClick={onBreadcrumbMiddleClick}
        onPathSubmit={onBreadcrumbPathSubmit}
        loadSubfoldersForPath={loadSubfoldersForPath}
        focusPathInputRequestKey={focusPathInputRequestKey}
        activeDragPaths={activeDragPaths}
        isMovingEntry={isMovingEntry}
        getDropIdForPath={getBreadcrumbDropId}
        workspaceFolderPathSet={workspaceFolderPathSet}
        recentFoldersEntries={recentFoldersEntries}
        isLoadingRecentFolders={isLoadingRecentFolders}
        onSelectRecentFolder={onSelectRecentFolder}
      />

      {!isLoadingEntries && !error && isGridView && (
        <FilesystemPanelGridContent
          paneId={paneId}
          entries={gridEntries}
          selectedPathSet={gridSelectedPathSet}
          thumbnailSrcByPath={gridThumbnailSrcByPath}
          workspaceFolderPathSet={gridWorkspaceFolderPathSet}
          columnCount={gridColumnCount}
          minCellWidthPx={gridMinCellWidthPx}
          previewSizePx={gridPreviewSizePx}
          rowHeightPx={gridRowHeightPx}
          containerRef={gridContainerRef}
          anchorRef={gridAnchorRef}
          topSpacerHeight={gridTopSpacerHeight}
          bottomSpacerHeight={gridBottomSpacerHeight}
          isWindowingEnabled={isGridWindowingEnabled}
          renamingPath={gridRenamingPath}
          drag={{
            selectedEntryPaths,
            isMovingEntry: isEntryOperationInProgress,
            activeDragPathSet,
            activeDropDestinationPath,
          }}
          onEntryClick={onGridEntryClick}
          onEntryDoubleClick={onGridEntryDoubleClick}
          onEntryMiddleClick={onGridEntryMiddleClick}
          onEntryContextMenu={onGridEntryContextMenu}
          onEntryRenameSubmit={onGridEntryRenameSubmit}
          onEntryRenameCancel={onGridEntryRenameCancel}
        />
      )}
      {unmatchedFilter && <p className={styles.muted}>No items match "{unmatchedFilter}".</p>}
      {search && <p
        className={`${styles.searchStatus} ${search.status === "error" ? styles.searchError : ""}`}
        role="status"
      >{describeSearch(search)}</p>}
      {!isLoadingEntries && !error && isFoldableGridView && (
        <FilesystemPanelFoldableGridContent
          paneId={paneId}
          lines={foldable.lines}
          containerRef={foldable.containerRef}
          anchorRef={foldable.anchorRef}
          isWindowingEnabled={foldable.isWindowingEnabled}
          topSpacerHeight={foldable.topSpacerHeight}
          bottomSpacerHeight={foldable.bottomSpacerHeight}
          tileLayouts={foldable.tileLayouts}
          minCellWidthPx={foldable.minCellWidthPx}
          folderLineHeightPx={foldable.folderLineHeightPx}
          currentPath={currentPath}
          isSearchActive={Boolean(search)}
          selectedPathSet={foldable.selectedPathSet}
          workspaceFolderPathSet={foldable.workspaceFolderPathSet}
          thumbnailSrcByPath={thumbnailSrcByPath}
          renamingPath={renamingPath}
          drag={{
            selectedEntryPaths,
            isMovingEntry: isEntryOperationInProgress,
            activeDragPathSet,
            activeDropDestinationPath,
          }}
          onToggleDirectoryExpanded={onToggleDirectoryExpanded}
          onEntryClick={onEntryClick}
          onEntryDoubleClick={onEntryDoubleClick}
          onEntryMiddleClick={onEntryMiddleClick}
          onEntryContextMenu={onEntryContextMenu}
          onEntryRenameSubmit={onEntryRenameSubmit}
          onEntryRenameCancel={onEntryRenameCancel}
        />
      )}
      {!isLoadingEntries && !error && !isGridView && !isFoldableGridView && <div
        className={`${styles.entryRows} ${isDetailsView ? styles.detailsRows : ""}`}
      >
        {isDetailsView && <FilesystemDetailsHeader
          sortKey={details.sortKey}
          sortDescending={details.sortDescending}
          onSort={details.onSort}
        />}
        <ul className={styles.entryList}>
          <li
            ref={entryWindowAnchorRef}
            className={styles.windowingAnchor}
            aria-hidden
          />
          {isEntryWindowingEnabled && topSpacerHeight > 0 && <li
            className={styles.windowingSpacer}
            style={{ height: `${topSpacerHeight}px` }}
            aria-hidden
          />}
          {renderedRows.map(row => {
            const isSearchResult = Boolean(search) && row.depth === 0;
            const parentPath = isSearchResult ? getParentDirectoryPath(row.entry.path) : row.parentPath;
            return <Fragment key={row.entry.path}>
            <DraggableFilesystemEntry
              paneId={paneId}
              entry={row.entry}
              drag={{
                dropDestinationPath: row.entry.is_dir ? row.entry.path : parentPath,
                selectedEntryPaths,
                isSelectedForDrag: selectedEntryPathSet.has(row.entry.path),
                isMovingEntry: isEntryOperationInProgress,
                activeDragPathSet,
                activeDropDestinationPath,
              }}
              view={{
                isSelected: selectedPathSet.has(row.entry.path),
                isWorkspaceFolder: workspaceFolderPathSet.has(row.entry.path),
                thumbnailSrc: thumbnailSrcByPath[row.entry.path] ?? "",
                nestingDepth: row.depth,
                isExpanded: row.isExpanded,
                isRenaming: row.entry.path === renamingPath,
                showDetails: isDetailsView,
                location: isSearchResult ? getResultLocation(row.entry.path, currentPath) : "",
              }}
              actions={{
                onToggleExpand: row.entry.is_dir
                  ? () => onToggleDirectoryExpanded?.(row.entry.path)
                  : undefined,
                onEntryClick,
                onEntryDoubleClick,
                onEntryMiddleClick,
                onEntryContextMenu,
                onEntryRenameSubmit,
                onEntryRenameCancel,
              }}
            />
            {row.isLoadingChildren && <EntryItem
              label="Loading..."
              meta=""
              nestingDepth={row.depth + 1}
            />}
          </Fragment>;
          })}
          {isEntryWindowingEnabled && bottomSpacerHeight > 0 && <li
            className={styles.windowingSpacer}
            style={{ height: `${bottomSpacerHeight}px` }}
            aria-hidden
          />}
        </ul>
      </div>}
      <DragOverlay dropAnimation={null}>
        {activeDragEntry && <div className={styles.dragOverlay}>
          <span className={styles.dragOverlayName}>
            {activeDragEntries.length > 1
              ? `${activeDragEntries.length} items`
              : activeDragEntry.name}
          </span>
          <span className={styles.dragOverlayMeta}>
            {getDragOverlayMeta(activeDragEntries, activeDragEntry)}
          </span>
          <span className={styles.dragOverlayIntent}>
            {dragIntentLabel}
          </span>
        </div>}
      </DragOverlay>
    </>}
  </div>;
}
