import { DragOverlay } from "@dnd-kit/core";
import { Fragment } from "react";
import Breadcrumbs from "./Breadcrumbs";
import DraggableFilesystemEntry from "./DraggableFilesystemEntry";
import EntryItem from "./EntryItem";
import UpEntryDropTarget from "./UpEntryDropTarget";
import styles from "./FilesystemPanel.module.scss";

export default function FilesystemPanelListContent({
  paneId = "",
  browse = {},
  drives = {},
  breadcrumbs = {},
  upEntry = {},
  windowing = {},
  entries = {},
  drag = {},
}) {
  const {
    isBrowsing = false,
    isLoadingDrives = false,
    isLoadingEntries = false,
    error = "",
    isEntryOperationInProgress = false,
  } = browse;
  const {
    items: driveItems = [],
    selectedPathSet = new Set(),
    onSelect: onDriveSelect = undefined,
    onOpen: onDriveOpen = undefined,
  } = drives;
  const {
    currentPath = "",
    currentDrive = "",
    onSelect: onBreadcrumbSelect = undefined,
    activeDragPaths = [],
    isMovingEntry = false,
    getDropIdForPath: getBreadcrumbDropId = undefined,
    workspaceFolderPathSet = new Set(),
  } = breadcrumbs;
  const {
    destinationPath: upDestinationPath = "",
    isSelected: isUpSelected = false,
    onSelect: onUpSelect = undefined,
    onOpen: onUpOpen = undefined,
  } = upEntry;
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
    thumbnailSrcByPath = {},
    onToggleDirectoryExpanded = undefined,
    onEntryClick = undefined,
    onEntryDoubleClick = undefined,
    onEntryMiddleClick = undefined,
  } = entries;
  const {
    activeEntry: activeDragEntry = null,
    activeEntries: activeDragEntries = [],
  } = drag;

  return <div
    className={styles.panelList}
    data-testid="filesystem-panel-list"
  >

    {!isBrowsing && !isLoadingDrives && !error && (
      <ul className={styles.entryList}>
        {driveItems.map((drive) => <EntryItem
          key={drive.path}
          label={drive.name}
          meta={drive.path}
          isSelected={selectedPathSet.has(drive.path)}
          isDirectory
          onClick={() => onDriveSelect?.(drive.path)}
          onDoubleClick={() => onDriveOpen?.(drive.path)}
        />)}
      </ul>
    )}

    {isBrowsing && (
      <>
        <Breadcrumbs
          currentPath={currentPath}
          currentDrive={currentDrive}
          onSelect={onBreadcrumbSelect}
          activeDragPaths={activeDragPaths}
          isMovingEntry={isMovingEntry}
          getDropIdForPath={getBreadcrumbDropId}
          workspaceFolderPathSet={workspaceFolderPathSet}
        />

        {!isLoadingEntries && !error && (
          <ul className={styles.entryList}>
            <UpEntryDropTarget
              destinationPath={upDestinationPath}
              isSelected={isUpSelected}
              isMovingEntry={isEntryOperationInProgress}
              activeDragPaths={activeDragPaths}
              onClick={onUpSelect}
              onDoubleClick={onUpOpen}
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
                drag={{
                  dropDestinationPath: row.entry.is_dir ? row.entry.path : row.parentPath,
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
                }}
                actions={{
                  onToggleExpand: row.entry.is_dir
                    ? () => onToggleDirectoryExpanded?.(row.entry.path)
                    : undefined,
                  onEntryClick,
                  onEntryDoubleClick,
                  onEntryMiddleClick,
                }}
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
  </div>;
}
