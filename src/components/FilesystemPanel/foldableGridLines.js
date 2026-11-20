// The foldable grid's layout: the tree rows cut into lines of three kinds. A "folder" line is one
// folder row, a "loading" line stands under a folder listed for the first time, and a "tiles" line
// holds up to columnCount files of one folder. A folder's files between two folder rows are a run,
// whose tile lines share one key, are numbered from 0 (indexInRun) and are drawn as one block
// (FilesystemPanelFoldableGridContent).

const ROW_INSET_PX = 8; // EntryItem .entryButton side padding (0.5rem)
const INDENT_GUIDE_PX = 16; // one EntryItem .indentGuide (1rem)
// Folder rows stop growing here: the tiles carry the previews.
export const FOLDABLE_FOLDER_ROW_MAX_HEIGHT_PX = 32;

// A nested tile line is inset like a folder row of its depth, so the rows' indent guides run on
// through the tiles. Root lines are not inset, so root tiles sit where grid view puts them.
export function getTileLineIndentPx(depth) {
  return depth > 0 ? ROW_INSET_PX + depth * INDENT_GUIDE_PX : 0;
}

export function getLineRows(line) {
  if (line.kind === "folder") return [line.row];
  return line.kind === "tiles" ? line.rows : [];
}

// Read in order, the lines hold every tree row exactly once, so the order on screen is the entry
// order that selection ranges, drags and rename work with. Files are never regrouped: any folder
// row ends a run of tiles. A run keeps its key when its files re-wrap (one added before others, a
// new column count), so its tiles keep their elements. A line's indexInRun doesn't depend on which
// lines the window renders, so it names the line's drop target while the window slides. Keys carry
// the depth because search can list a folder twice (as a result and inside an opened result). Runs
// are numbered per folder, so a new run in one folder doesn't change the keys of the others.
// `columnCounts` holds the column count of every depth the rows reach.
export function buildFoldableGridLines(treeRows, columnCounts) {
  const lines = [];
  const runCountByParent = new Map();
  treeRows.forEach((row) => {
    const { entry, depth, parentPath } = row;
    if (entry.is_dir) {
      lines.push({ kind: "folder", key: `folder:${depth}:${entry.path}`, depth, row });
      if (row.isLoadingChildren) {
        lines.push({ kind: "loading", key: `loading:${depth}:${entry.path}`, depth: depth + 1 });
      }
      return;
    }

    const lastLine = lines.at(-1);
    if (lastLine?.kind === "tiles" && lastLine.parentPath === parentPath) {
      // The run goes on: on its last line while that has room, else on a new line of the run.
      if (lastLine.rows.length < lastLine.columnCount) lastLine.rows.push(row);
      else lines.push({ ...lastLine, indexInRun: lastLine.indexInRun + 1, rows: [row] });
      return;
    }

    const parentKey = `${depth}:${parentPath}`;
    const runNumber = runCountByParent.get(parentKey) ?? 0;
    runCountByParent.set(parentKey, runNumber + 1);
    lines.push({
      kind: "tiles",
      key: `tiles:${parentKey}:${runNumber}`,
      depth,
      parentPath,
      columnCount: columnCounts[depth],
      indexInRun: 0,
      rows: [row],
    });
  });
  return lines;
}

// The top of every line, then the total height. A tile line is as tall as the tiles of its depth
// (`tileLineHeightsPx`, by depth). Root entries not loaded yet count as root tile lines after
// everything loaded, so the scroll height covers the whole folder from the first page on.
export function getLineOffsets(lines, { folderLineHeightPx, tileLineHeightsPx }, placeholderLineCount) {
  const offsets = [0];
  const addLine = (heightPx) => offsets.push(offsets.at(-1) + heightPx);
  lines.forEach((line) => addLine(line.kind === "tiles" ? tileLineHeightsPx[line.depth] : folderLineHeightPx));
  for (let index = 0; index < placeholderLineCount; index += 1) addLine(tileLineHeightsPx[0]);
  return offsets;
}

// The index of the line holding `path`, or -1.
export function findLineIndex(lines, path) {
  return lines.findIndex((line) => getLineRows(line).some((row) => row.entry.path === path));
}

// The entry on the line above (direction -1) or below (1) the line holding `path`: the same column
// on a tile line, clamped to its length, or the folder of a folder line, which counts as column 0.
// Loading lines are skipped. Past the first or the last line it wraps around, or gives "" when
// `wraps` is false. Also "" when no line holds `path`.
export function findVerticalNeighbourPath(lines, path, direction, wraps) {
  const lineIndex = findLineIndex(lines, path);
  if (lineIndex < 0) return "";

  const column = getLineRows(lines[lineIndex]).findIndex((row) => row.entry.path === path);
  let nextIndex = lineIndex;
  do {
    nextIndex += direction;
    if (!wraps && (nextIndex < 0 || nextIndex >= lines.length)) return "";
    nextIndex = (nextIndex + lines.length) % lines.length;
  } while (getLineRows(lines[nextIndex]).length === 0);
  const nextRows = getLineRows(lines[nextIndex]);
  return nextRows[Math.min(column, nextRows.length - 1)].entry.path;
}
