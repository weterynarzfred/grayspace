import { DragOverlay } from "@dnd-kit/core";
import { Fragment } from "react";
import Breadcrumbs from "./Breadcrumbs";
import DraggableFilesystemEntry from "./DraggableFilesystemEntry";
import EntryItem from "./EntryItem";
import UpEntryDropTarget from "./UpEntryDropTarget";
import styles from "./FilesystemPanel.module.scss";

export default function FilesystemPanelListContent({
  paneId = "",
  isBrowsing = false,
  isLoadingDrives = false,
  isLoadingEntries = false,
  error = "",
  drives = [],
  selectedPathSet = new Set(),
  onDriveSelect = undefined,
  onDriveOpen = undefined,
  currentPath = "",
  currentDrive = "",
  onBreadcrumbSelect = undefined,
  activeDragPaths = [],
  isMovingEntry = false,
  getBreadcrumbDropId = undefined,
  workspaceFolderPathSet = new Set(),
  upDestinationPath = "",
  isUpSelected = false,
  isEntryOperationInProgress = false,
  onUpSelect = undefined,
  onUpOpen = undefined,
  entryWindowAnchorRef = undefined,
  isEntryWindowingEnabled = false,
  topSpacerHeight = 0,
  bottomSpacerHeight = 0,
  renderedRows = [],
  selectedEntryPaths = [],
  selectedEntryPathSet = new Set(),
  activeDragPathSet = new Set(),
  activeDropDestinationPath = "",
  thumbnailSrcByPath = {},
  onToggleDirectoryExpanded = undefined,
  onEntryClick = undefined,
  onEntryDoubleClick = undefined,
  onEntryMiddleClick = undefined,
  activeDragEntry = null,
  activeDragEntries = [],
}) {
  return <div
    className={styles.panelList}
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
                dropDestinationPath={row.entry.is_dir ? row.entry.path : row.parentPath}
                selectedEntryPaths={selectedEntryPaths}
                isSelectedForDrag={selectedEntryPathSet.has(row.entry.path)}
                isSelected={selectedPathSet.has(row.entry.path)}
                isMovingEntry={isEntryOperationInProgress}
                activeDragPathSet={activeDragPathSet}
                activeDropDestinationPath={activeDropDestinationPath}
                isWorkspaceFolder={workspaceFolderPathSet.has(row.entry.path)}
                thumbnailSrc={thumbnailSrcByPath[row.entry.path] ?? ""}
                nestingDepth={row.depth}
                isExpanded={row.isExpanded}
                onToggleExpand={row.entry.is_dir ? () => onToggleDirectoryExpanded?.(row.entry.path) : undefined}
                onEntryClick={onEntryClick}
                onEntryDoubleClick={onEntryDoubleClick}
                onEntryMiddleClick={onEntryMiddleClick}
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
