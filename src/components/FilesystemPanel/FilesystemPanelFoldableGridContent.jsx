import { useDroppable } from "@dnd-kit/core";
import DraggableFilesystemEntry from "./DraggableFilesystemEntry";
import EntryItem, { EntryIndent } from "./EntryItem";
import GridEntryCell from "./GridEntryCell";
import { getFoldableRunLineDndId } from "./dndIds";
import { getResultLocation } from "./filesystemPanelUtils";
import styles from "./FilesystemPanelFoldableGridContent.module.scss";

// The drop target over one rendered line of a nested run. One per line, not one for the run:
// pointerWithin ranks the droppables under the pointer by their corners' mean distance from it, so
// a run taller than the pane would lose to the pane's droppable (the current folder).
function FoldableRunLineDropTarget({ id, index, data }) {
  const { setNodeRef } = useDroppable({ id, data });
  return (
    <div ref={setNodeRef} className={styles.tileRunLine} style={{ "--line-index": index }} aria-hidden />
  );
}

// The rendered lines of one run (a folder's files between folder rows) as one grid, so a tile
// that moves to another line keeps its element, and with it the focus or an open rename. Its
// tiles, lines and drop targets take the sizes of its depth (`tileLayout`). A nested run is inset
// like the rows of its depth and draws their indent guides. Its empty space takes drops (from the
// app or from Explorer) into its folder, as the folder tree's rows of an opened folder do; clicks
// there still count as the pane's empty space. Root runs leave drops to the pane: the current
// folder.
function FoldableTileRun({ paneId, lines, tileLayout, drag, children }) {
  const { key, depth, parentPath, columnCount } = lines[0];
  const isNested = depth > 0;
  // Lit with the folder's row (useFilesystemEntryDnd) whenever a drag would drop into the folder.
  const isDropTarget = isNested
    && drag.activeDragPathSet.size > 0
    && drag.activeDropDestinationPath === parentPath
    && !drag.activeDragPathSet.has(parentPath);
  const className = [
    styles.tileRun,
    isNested ? styles.tileRunNested : "",
    isDropTarget ? styles.tileRunDropTarget : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={className}
      style={{
        "--line-cols": columnCount,
        "--grid-cell-width": `${tileLayout.cellWidthPx}px`,
        "--grid-preview-size": `${tileLayout.previewSizePx}px`,
        "--tile-line-height": `${tileLayout.lineHeightPx}px`,
      }}
      data-drop-destination-path={isNested ? parentPath : undefined}
    >
      {isNested && lines.map((line, index) => (
        <FoldableRunLineDropTarget
          key={line.indexInRun}
          id={getFoldableRunLineDndId(paneId, key, line.indexInRun)}
          index={index}
          data={{ kind: "folder-run", path: parentPath, isDirectory: true, paneId }}
        />
      ))}
      <EntryIndent depth={depth} />
      <div className={styles.tileCells}>{children}</div>
    </div>
  );
}

// The tree rows drawn as lines (see foldableGridLines.js): folders stay tree rows at every depth,
// and the files under a folder's row are tiles that fill the width of their depth, as grid view's
// fill the pane. `tileLayouts` holds the sizes of every depth (useFoldableGridLayout).
export default function FilesystemPanelFoldableGridContent({
  paneId = "",
  lines = [],
  containerRef = undefined,
  anchorRef = undefined,
  isWindowingEnabled = false,
  topSpacerHeight = 0,
  bottomSpacerHeight = 0,
  tileLayouts = [],
  minCellWidthPx = 72,
  folderLineHeightPx = 22,
  currentPath = "",
  isSearchActive = false,
  selectedPathSet = new Set(),
  workspaceFolderPathSet = new Set(),
  thumbnailSrcByPath = {},
  renamingPath = "",
  drag = {},
  onToggleDirectoryExpanded = undefined,
  onEntryClick = undefined,
  onEntryDoubleClick = undefined,
  onEntryMiddleClick = undefined,
  onEntryContextMenu = undefined,
  onEntryRenameSubmit = undefined,
  onEntryRenameCancel = undefined,
}) {
  // The lines stay the window's unit; the rendered ones of a run (next to each other, sharing its
  // key) become one block.
  const blocks = [];
  lines.forEach((line) => {
    const previousBlock = blocks.at(-1);
    if (line.kind !== "tiles") blocks.push(line);
    else if (previousBlock?.key === line.key) previousBlock.lines.push(line);
    else blocks.push({ kind: "run", key: line.key, lines: [line] });
  });

  return (
    <div
      ref={containerRef}
      className={styles.foldableGrid}
      data-testid="filesystem-foldable-grid"
      style={{
        "--grid-min-cell-width": `${minCellWidthPx}px`,
        // The tiles carry the previews, so folder rows keep to a compact size.
        "--entry-row-height": `${folderLineHeightPx}px`,
        "--entry-thumbnail-size": `${folderLineHeightPx}px`,
      }}
    >
      <div ref={anchorRef} aria-hidden />
      {isWindowingEnabled && topSpacerHeight > 0 && (
        <div style={{ height: `${topSpacerHeight}px` }} aria-hidden />
      )}
      {blocks.map((block) => {
        if (block.kind === "loading") {
          return (
            <ul key={block.key} className={styles.rowLine}>
              <EntryItem label="Loading..." meta="" nestingDepth={block.depth} />
            </ul>
          );
        }

        if (block.kind === "folder") {
          const { entry, isExpanded } = block.row;
          return (
            <ul key={block.key} className={styles.rowLine}>
              <DraggableFilesystemEntry
                paneId={paneId}
                entry={entry}
                drag={{ ...drag, isSelectedForDrag: selectedPathSet.has(entry.path) }}
                view={{
                  isSelected: selectedPathSet.has(entry.path),
                  isWorkspaceFolder: workspaceFolderPathSet.has(entry.path),
                  nestingDepth: block.depth,
                  isExpanded,
                  isRenaming: entry.path === renamingPath,
                  location: isSearchActive && block.depth === 0 ? getResultLocation(entry.path, currentPath) : "",
                }}
                actions={{
                  onToggleExpand: () => onToggleDirectoryExpanded?.(entry.path),
                  onEntryClick,
                  onEntryDoubleClick,
                  onEntryMiddleClick,
                  onEntryContextMenu,
                  onEntryRenameSubmit,
                  onEntryRenameCancel,
                }}
              />
            </ul>
          );
        }

        return (
          <FoldableTileRun
            key={block.key}
            paneId={paneId}
            lines={block.lines}
            tileLayout={tileLayouts[block.lines[0].depth]}
            drag={drag}
          >
            {block.lines.flatMap((line) => line.rows).map(({ entry }) => (
              <GridEntryCell
                key={entry.path}
                paneId={paneId}
                entry={entry}
                isSelected={selectedPathSet.has(entry.path)}
                isConfig={false}
                isRenaming={entry.path === renamingPath}
                thumbnailSrc={thumbnailSrcByPath[entry.path] ?? ""}
                drag={drag}
                onEntryClick={onEntryClick}
                onEntryDoubleClick={onEntryDoubleClick}
                onEntryMiddleClick={onEntryMiddleClick}
                onEntryContextMenu={onEntryContextMenu}
                onEntryRenameSubmit={onEntryRenameSubmit}
                onEntryRenameCancel={onEntryRenameCancel}
              />
            ))}
          </FoldableTileRun>
        );
      })}
      {isWindowingEnabled && bottomSpacerHeight > 0 && (
        <div style={{ height: `${bottomSpacerHeight}px` }} aria-hidden />
      )}
    </div>
  );
}
