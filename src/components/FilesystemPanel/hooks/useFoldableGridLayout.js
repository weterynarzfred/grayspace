import { useCallback, useMemo } from "react";
import {
  FOLDABLE_FOLDER_ROW_MAX_HEIGHT_PX,
  buildFoldableGridLines,
  findLineIndex,
  findVerticalNeighbourPath,
  getLineOffsets,
  getLineRows,
  getTileLineIndentPx,
} from "../foldableGridLines";
import { fitGridColumns } from "./useGridLayout";
import useVirtualizedEntryWindow from "./useVirtualizedEntryWindow";

// Nested tiles may shrink to this share of the minimum cell width to keep their parent's columns.
const NESTED_MIN_CELL_SCALE = 0.9;

// A nested level's columns: as many of its parent's as fit in cells that fill its width and stay
// at least NESTED_MIN_CELL_SCALE of the minimum, one column fewer at a time; as at the root
// (fitGridColumns) when not even one does.
function fitNestedGridColumns(widthPx, parentColumnCount, minCellWidthPx, gapPx) {
  for (let columnCount = parentColumnCount; columnCount > 0; columnCount -= 1) {
    const cellWidthPx = Math.floor((widthPx - (columnCount - 1) * gapPx) / columnCount);
    if (cellWidthPx >= NESTED_MIN_CELL_SCALE * minCellWidthPx) return { columnCount, cellWidthPx };
  }
  return fitGridColumns(widthPx, minCellWidthPx, gapPx);
}

// The foldable grid's lines (see foldableGridLines.js) and the window of them to render. The lines
// are built only while the view is on, so the other views pay nothing for them.
export default function useFoldableGridLayout({
  isEnabled,
  isWindowingEnabled,
  treeRows,
  unresolvedRootEntryCount,
  thumbnailSizePx,
  availableWidthPx,
  minCellWidthPx,
  gapPx,
  // (cellWidthPx) => the { previewSizePx, lineHeightPx } of a tile that wide, as in grid view.
  getTileSize,
  scrollContainerRef,
  anchorRef,
}) {
  const folderLineHeightPx = Math.min(thumbnailSizePx, FOLDABLE_FOLDER_ROW_MAX_HEIGHT_PX);
  // Each depth's lines fill their own width, the pane's less their indent. Depth 0 is grid view's
  // layout. Deeper levels keep their parent's column count where they can (fitNestedGridColumns):
  // fitted on their own, an indent that costs a column would stretch the rest, so opened folders
  // would show bigger tiles than the level around them. By depth: { columnCount, cellWidthPx,
  // previewSizePx, lineHeightPx }.
  const deepestDepth = isEnabled ? treeRows.reduce((deepest, row) => Math.max(deepest, row.depth), 0) : 0;
  const tileLayouts = useMemo(() => {
    const layouts = [];
    for (let depth = 0; depth <= deepestDepth; depth += 1) {
      const lineWidthPx = availableWidthPx - getTileLineIndentPx(depth);
      const { columnCount, cellWidthPx } = depth === 0
        ? fitGridColumns(lineWidthPx, minCellWidthPx, gapPx)
        : fitNestedGridColumns(lineWidthPx, layouts[depth - 1].columnCount, minCellWidthPx, gapPx);
      const { previewSizePx, lineHeightPx } = getTileSize(cellWidthPx);
      layouts.push({ columnCount, cellWidthPx, previewSizePx, lineHeightPx });
    }
    return layouts;
  }, [availableWidthPx, deepestDepth, gapPx, getTileSize, minCellWidthPx]);
  // The lines are built again only when a depth's column count changes, not on every pixel of a
  // resize: new lines would ask again for the thumbnails of every rendered tile. They are built
  // from the key, which is what the memo compares.
  const columnCountKey = tileLayouts.map((layout) => layout.columnCount).join(",");
  const lines = useMemo(() => (
    isEnabled ? buildFoldableGridLines(treeRows, columnCountKey.split(",").map(Number)) : []
  ), [columnCountKey, isEnabled, treeRows]);
  // Root entries not listed yet are taken for files, so the scroll height covers them from the
  // first page on.
  const placeholderLineCount = isEnabled ? Math.ceil(unresolvedRootEntryCount / tileLayouts[0].columnCount) : 0;
  const lineOffsets = useMemo(() => getLineOffsets(
    lines,
    { folderLineHeightPx, tileLineHeightsPx: tileLayouts.map((layout) => layout.lineHeightPx) },
    placeholderLineCount,
  ), [folderLineHeightPx, lines, placeholderLineCount, tileLayouts]);
  const {
    startIndex,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    scheduleRecompute,
    scrollRowIntoView,
  } = useVirtualizedEntryWindow({
    itemCount: lineOffsets.length - 1,
    rowHeightPx: tileLayouts[0].lineHeightPx,
    rowOffsetsPx: lineOffsets,
    isEnabled: isWindowingEnabled,
    scrollContainerRef,
    listStartAnchorRef: anchorRef,
  });
  const renderedLines = useMemo(() => (
    isWindowingEnabled
      ? lines.slice(Math.min(startIndex, lines.length), Math.min(endIndex, lines.length))
      : lines
  ), [endIndex, isWindowingEnabled, lines, startIndex]);
  const visibleEntries = useMemo(
    () => renderedLines.flatMap((line) => getLineRows(line).map((row) => row.entry)),
    [renderedLines],
  );
  const getVerticalNeighbourPath = useCallback(
    (path, direction, wraps) => findVerticalNeighbourPath(lines, path, direction, wraps),
    [lines],
  );
  // Scrolls to the line holding `path`, for an entry outside the window.
  const scrollEntryIntoView = useCallback(
    (path) => scrollRowIntoView(findLineIndex(lines, path)),
    [lines, scrollRowIntoView],
  );

  return {
    lines: renderedLines,
    tileLayouts,
    folderLineHeightPx,
    visibleEntries,
    loadedLineCount: lines.length,
    endIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    scheduleRecompute,
    getVerticalNeighbourPath,
    scrollEntryIntoView,
  };
}
