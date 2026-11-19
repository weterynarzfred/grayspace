import {
  buildFoldableGridLines,
  findVerticalNeighbourPath,
  getLineOffsets,
  getLineRows,
  getTileLineIndentPx,
} from "./foldableGridLines";

const ROOT = "C:\\";
// Column counts by depth, at the depths the tests reach: 4 at the root and 3 below it, so the
// levels wrap differently.
const COLUMN_COUNTS = [4, 3, 3, 3];

function getName(path) {
  return path.slice(path.lastIndexOf("\\") + 1);
}

// Tree rows as useFilesystemTree flattens them: parentPath is the folder that listed the row.
function fileRow(path, depth, parentPath) {
  return {
    entry: { name: getName(path), path, is_dir: false },
    depth,
    parentPath,
    isExpanded: false,
    isLoadingChildren: false,
  };
}

function folderRow(path, depth, parentPath, { isExpanded = false, isLoadingChildren = false } = {}) {
  return {
    entry: { name: getName(path), path, is_dir: true },
    depth,
    parentPath,
    isExpanded,
    isLoadingChildren,
  };
}

function summarizeLines(lines) {
  return lines.map((line) => [line.kind, line.depth, getLineRows(line).map((row) => row.entry.name)]);
}

// The C:\ listing of FilesystemPanel.test.jsx.
const ROOT_ROWS = [
  folderRow("C:\\Users", 0, ROOT),
  folderRow("C:\\Temp", 0, ROOT),
  fileRow("C:\\notes.txt", 0, ROOT),
  fileRow("C:\\draft.md", 0, ROOT),
  folderRow("C:\\.grayspace", 0, ROOT),
];
const USERS_OPEN_ROWS = [
  folderRow("C:\\Users", 0, ROOT, { isExpanded: true }),
  folderRow("C:\\Users\\Projects", 1, "C:\\Users"),
  fileRow("C:\\Users\\todo.txt", 1, "C:\\Users"),
  folderRow("C:\\Users\\.grayspace", 1, "C:\\Users"),
  ...ROOT_ROWS.slice(1),
];
const INTERLEAVED_ROWS = [
  fileRow("C:\\x.txt", 0, ROOT),
  folderRow("C:\\F1", 0, ROOT),
  fileRow("C:\\y.txt", 0, ROOT),
  fileRow("C:\\z.txt", 0, ROOT),
  folderRow("C:\\F2", 0, ROOT),
  fileRow("C:\\w.txt", 0, ROOT),
];
const THREE_LEVEL_ROWS = [
  folderRow("C:\\A", 0, ROOT, { isExpanded: true }),
  folderRow("C:\\A\\B", 1, "C:\\A", { isExpanded: true }),
  fileRow("C:\\A\\B\\b1.txt", 2, "C:\\A\\B"),
  fileRow("C:\\A\\B\\b2.txt", 2, "C:\\A\\B"),
  folderRow("C:\\A\\B\\C", 2, "C:\\A\\B", { isExpanded: true, isLoadingChildren: true }),
  fileRow("C:\\A\\B\\b3.txt", 2, "C:\\A\\B"),
  fileRow("C:\\A\\a1.txt", 1, "C:\\A"),
  fileRow("C:\\root.txt", 0, ROOT),
];

// The keyboard scenario: root folder Media holding m1..m3, then root files a..f. Closed, that is
// the lines [Media][a b c d][e f].
function buildMediaLines({ isMediaOpen }) {
  const mediaRows = isMediaOpen
    ? ["m1", "m2", "m3"].map((name) => fileRow(`C:\\Media\\${name}`, 1, "C:\\Media"))
    : [];
  return buildFoldableGridLines([
    folderRow("C:\\Media", 0, ROOT, { isExpanded: isMediaOpen }),
    ...mediaRows,
    ...["a", "b", "c", "d", "e", "f"].map((name) => fileRow(`C:\\${name}`, 0, ROOT)),
  ], COLUMN_COUNTS);
}

describe("buildFoldableGridLines", () => {
  it("gives each folder a line and wraps the files between folders into tile lines", () => {
    expect(summarizeLines(buildFoldableGridLines(ROOT_ROWS, COLUMN_COUNTS))).toEqual([
      ["folder", 0, ["Users"]],
      ["folder", 0, ["Temp"]],
      ["tiles", 0, ["notes.txt", "draft.md"]],
      ["folder", 0, [".grayspace"]],
    ]);
  });

  it("puts an opened folder's contents under its row, one level in", () => {
    const lines = buildFoldableGridLines(USERS_OPEN_ROWS, COLUMN_COUNTS);

    expect(summarizeLines(lines)).toEqual([
      ["folder", 0, ["Users"]],
      ["folder", 1, ["Projects"]],
      ["tiles", 1, ["todo.txt"]],
      ["folder", 1, [".grayspace"]],
      ["folder", 0, ["Temp"]],
      ["tiles", 0, ["notes.txt", "draft.md"]],
      ["folder", 0, [".grayspace"]],
    ]);
    expect(lines[2]).toMatchObject({ key: "tiles:1:C:\\Users:0", parentPath: "C:\\Users", columnCount: 3 });
    expect(lines[5]).toMatchObject({ key: "tiles:0:C:\\:0", parentPath: ROOT, columnCount: 4 });
  });

  it("ends a run of tiles at every folder row and every change of folder, at any depth", () => {
    expect(summarizeLines(buildFoldableGridLines(THREE_LEVEL_ROWS, COLUMN_COUNTS))).toEqual([
      ["folder", 0, ["A"]],
      ["folder", 1, ["B"]],
      ["tiles", 2, ["b1.txt", "b2.txt"]],
      ["folder", 2, ["C"]],
      ["loading", 3, []],
      ["tiles", 2, ["b3.txt"]],
      ["tiles", 1, ["a1.txt"]],
      ["tiles", 0, ["root.txt"]],
    ]);
  });

  it.each([
    ["the C:\\ listing with Users open", USERS_OPEN_ROWS],
    ["files and folders interleaved", INTERLEAVED_ROWS],
    ["a three-level tree", THREE_LEVEL_ROWS],
  ])("holds every tree row once and in order: %s", (_, treeRows) => {
    expect(buildFoldableGridLines(treeRows, COLUMN_COUNTS).flatMap(getLineRows)).toEqual(treeRows);
  });

  it("wraps 7 files at 3 columns into lines of 3, 3 and 1", () => {
    const fileRows = ["1", "2", "3", "4", "5", "6", "7"].map((name) => fileRow(`C:\\${name}`, 0, ROOT));

    const lines = buildFoldableGridLines(fileRows, [3]);

    expect(lines.map((line) => line.rows.length)).toEqual([3, 3, 1]);
    expect(lines.map((line) => line.columnCount)).toEqual([3, 3, 3]);
  });

  it("wraps each folder's files at the column count of their depth", () => {
    const lines = buildFoldableGridLines([
      folderRow("C:\\Users", 0, ROOT, { isExpanded: true }),
      ...["u1", "u2", "u3", "u4"].map((name) => fileRow(`C:\\Users\\${name}`, 1, "C:\\Users")),
      ...["r1", "r2", "r3", "r4"].map((name) => fileRow(`C:\\${name}`, 0, ROOT)),
    ], COLUMN_COUNTS);

    expect(summarizeLines(lines)).toEqual([
      ["folder", 0, ["Users"]],
      ["tiles", 1, ["u1", "u2", "u3"]],
      ["tiles", 1, ["u4"]],
      ["tiles", 0, ["r1", "r2", "r3", "r4"]],
    ]);
  });

  it("adds one loading line, a level deeper, under a folder listed for the first time", () => {
    const lines = buildFoldableGridLines([
      folderRow("C:\\Users", 0, ROOT, { isExpanded: true, isLoadingChildren: true }),
      ...ROOT_ROWS.slice(1),
    ], COLUMN_COUNTS);

    expect(summarizeLines(lines).slice(0, 3)).toEqual([
      ["folder", 0, ["Users"]],
      ["loading", 1, []],
      ["folder", 0, ["Temp"]],
    ]);
    expect(lines[1].key).toBe("loading:0:C:\\Users");
  });

  it("numbers runs per folder", () => {
    expect(buildFoldableGridLines(INTERLEAVED_ROWS, COLUMN_COUNTS).map((line) => line.key)).toEqual([
      "tiles:0:C:\\:0",
      "folder:0:C:\\F1",
      "tiles:0:C:\\:1",
      "folder:0:C:\\F2",
      "tiles:0:C:\\:2",
    ]);
  });

  it("gives every line of a run the run's key, and its number in the run", () => {
    const lines = buildFoldableGridLines([
      ...["r1", "r2", "r3", "r4", "r5"].map((name) => fileRow(`C:\\${name}`, 0, ROOT)),
      folderRow("C:\\F1", 0, ROOT),
      fileRow("C:\\r6", 0, ROOT),
    ], COLUMN_COUNTS);

    expect(summarizeLines(lines)).toEqual([
      ["tiles", 0, ["r1", "r2", "r3", "r4"]],
      ["tiles", 0, ["r5"]],
      ["folder", 0, ["F1"]],
      ["tiles", 0, ["r6"]],
    ]);
    expect(lines.map((line) => line.key)).toEqual(["tiles:0:C:\\:0", "tiles:0:C:\\:0", "folder:0:C:\\F1", "tiles:0:C:\\:1"]);
    expect(lines.map((line) => line.indexInRun)).toEqual([0, 1, undefined, 0]);
  });

  it("keeps a run's key when its files wrap anew, and the keys of the other folders' lines", () => {
    const usersRow = folderRow("C:\\Users", 0, ROOT, { isExpanded: true });
    const tailRows = [folderRow("C:\\Temp", 0, ROOT), fileRow("C:\\notes.txt", 0, ROOT)];
    const userFileRows = ["todo.txt", "a.txt", "b.txt", "c.txt"]
      .map((name) => fileRow(`C:\\Users\\${name}`, 1, "C:\\Users"));

    const before = buildFoldableGridLines([usersRow, userFileRows[0], ...tailRows], COLUMN_COUNTS);
    const added = buildFoldableGridLines([usersRow, ...userFileRows, ...tailRows], COLUMN_COUNTS);
    const narrower = buildFoldableGridLines([usersRow, ...userFileRows, ...tailRows], [4, 2]);

    expect(before.map((line) => line.key)).toEqual([
      "folder:0:C:\\Users",
      "tiles:1:C:\\Users:0",
      "folder:0:C:\\Temp",
      "tiles:0:C:\\:0",
    ]);
    expect(added.map((line) => line.key)).toEqual([
      "folder:0:C:\\Users",
      "tiles:1:C:\\Users:0",
      "tiles:1:C:\\Users:0",
      "folder:0:C:\\Temp",
      "tiles:0:C:\\:0",
    ]);
    expect(summarizeLines(narrower).slice(1, 3)).toEqual([
      ["tiles", 1, ["todo.txt", "a.txt"]],
      ["tiles", 1, ["b.txt", "c.txt"]],
    ]);
    expect(narrower.map((line) => line.key)).toEqual(added.map((line) => line.key));
  });

  it("keeps the keys of blocks unique when search lists a folder as a result and inside an opened result", () => {
    // Search results are root rows wherever they live, so C:\Users\Projects shows at depth 0 and,
    // inside the opened result C:\Users, at depth 1.
    const treeRows = [
      folderRow("C:\\Users", 0, ROOT, { isExpanded: true }),
      folderRow("C:\\Users\\Projects", 1, "C:\\Users", { isExpanded: true }),
      fileRow("C:\\Users\\Projects\\plan.md", 2, "C:\\Users\\Projects"),
      fileRow("C:\\Users\\todo.txt", 1, "C:\\Users"),
      folderRow("C:\\Users\\Projects", 0, ROOT, { isExpanded: true }),
      fileRow("C:\\Users\\Projects\\plan.md", 1, "C:\\Users\\Projects"),
      fileRow("C:\\Users\\todo.txt", 0, ROOT),
    ];

    const lines = buildFoldableGridLines(treeRows, COLUMN_COUNTS);
    // The grid draws a run's lines, which sit next to each other, as one block.
    const blockKeys = lines.map((line) => line.key).filter((key, index, keys) => key !== keys[index - 1]);

    expect(new Set(blockKeys).size).toBe(blockKeys.length);
    expect(lines.flatMap(getLineRows)).toEqual(treeRows);
  });
});

describe("getTileLineIndentPx", () => {
  it("indents nested lines like the folder rows of their depth, and root lines not at all", () => {
    expect([0, 1, 2].map((depth) => getTileLineIndentPx(depth))).toEqual([0, 24, 40]);
  });
});

describe("getLineOffsets", () => {
  // 32 px folder rows, and tile lines of a preview filling the cell, the 32 px label and the 8 px
  // gap: 170 px for the root's 140 px cells, 211 px for 181 px cells one level in.
  const heights = { folderLineHeightPx: 32, tileLineHeightsPx: [170, 211] };

  it("stacks the lines' heights, each tile line at its depth's, then root tile lines for root entries not loaded yet", () => {
    const lines = buildFoldableGridLines([
      folderRow("C:\\Users", 0, ROOT, { isExpanded: true }),
      ...["u1", "u2", "u3", "u4"].map((name) => fileRow(`C:\\Users\\${name}`, 1, "C:\\Users")),
      folderRow("C:\\Users\\Projects", 1, "C:\\Users", { isExpanded: true, isLoadingChildren: true }),
      ...["a", "b", "c", "d", "e", "f"].map((name) => fileRow(`C:\\${name}`, 0, ROOT)),
      folderRow("C:\\Temp", 0, ROOT),
    ], COLUMN_COUNTS);
    // 10 unloaded root entries take 3 lines of the 4 root columns.
    const placeholderLineCount = Math.ceil(10 / COLUMN_COUNTS[0]);

    expect(summarizeLines(lines).map(([kind, depth]) => [kind, depth])).toEqual([
      ["folder", 0],
      ["tiles", 1],
      ["tiles", 1],
      ["folder", 1],
      ["loading", 2],
      ["tiles", 0],
      ["tiles", 0],
      ["folder", 0],
    ]);
    expect(getLineOffsets(lines, heights, 0)).toEqual([0, 32, 243, 454, 486, 518, 688, 858, 890]);
    expect(getLineOffsets(lines, heights, placeholderLineCount))
      .toEqual([0, 32, 243, 454, 486, 518, 688, 858, 890, 1060, 1230, 1400]);
  });

  it("is a single zero without lines", () => {
    expect(getLineOffsets([], heights, 0)).toEqual([0]);
  });
});

describe("findVerticalNeighbourPath", () => {
  const above = (lines, path, wraps = true) => findVerticalNeighbourPath(lines, path, -1, wraps);
  const below = (lines, path, wraps = true) => findVerticalNeighbourPath(lines, path, 1, wraps);

  it("builds the keyboard scenario's lines", () => {
    expect(summarizeLines(buildMediaLines({ isMediaOpen: false }))).toEqual([
      ["folder", 0, ["Media"]],
      ["tiles", 0, ["a", "b", "c", "d"]],
      ["tiles", 0, ["e", "f"]],
    ]);
    expect(summarizeLines(buildMediaLines({ isMediaOpen: true }))).toEqual([
      ["folder", 0, ["Media"]],
      ["tiles", 1, ["m1", "m2", "m3"]],
      ["tiles", 0, ["a", "b", "c", "d"]],
      ["tiles", 0, ["e", "f"]],
    ]);
  });

  it("keeps the column on the next line and clamps it to a shorter line", () => {
    const lines = buildMediaLines({ isMediaOpen: false });

    expect(below(lines, "C:\\a")).toBe("C:\\e");
    expect(below(lines, "C:\\b")).toBe("C:\\f");
    expect(below(lines, "C:\\c")).toBe("C:\\f");
    expect(above(lines, "C:\\f")).toBe("C:\\b");
    expect(above(lines, "C:\\e")).toBe("C:\\a");
  });

  it("keeps the column across lines of different depths", () => {
    const lines = buildMediaLines({ isMediaOpen: true });

    expect(below(lines, "C:\\Media\\m2")).toBe("C:\\b");
    expect(above(lines, "C:\\b")).toBe("C:\\Media\\m2");
    expect(above(lines, "C:\\d")).toBe("C:\\Media\\m3");
  });

  it("treats a folder row as column 0 in both directions", () => {
    const closedLines = buildMediaLines({ isMediaOpen: false });
    const openLines = buildMediaLines({ isMediaOpen: true });

    expect(above(closedLines, "C:\\a")).toBe("C:\\Media");
    expect(above(closedLines, "C:\\d")).toBe("C:\\Media");
    expect(below(closedLines, "C:\\Media")).toBe("C:\\a");
    expect(below(openLines, "C:\\Media")).toBe("C:\\Media\\m1");
    expect(above(openLines, "C:\\Media\\m3")).toBe("C:\\Media");
  });

  it("wraps at both ends", () => {
    const lines = buildMediaLines({ isMediaOpen: false });

    expect(above(lines, "C:\\Media")).toBe("C:\\e");
    expect(below(lines, "C:\\e")).toBe("C:\\Media");
    expect(below(lines, "C:\\f")).toBe("C:\\Media");
  });

  it("stops at the first and the last line when not wrapping, past loading lines too", () => {
    const lines = buildMediaLines({ isMediaOpen: false });
    const linesEndingInLoading = buildFoldableGridLines([
      fileRow("C:\\notes.txt", 0, ROOT),
      folderRow("C:\\Users", 0, ROOT, { isExpanded: true, isLoadingChildren: true }),
    ], COLUMN_COUNTS);

    expect(above(lines, "C:\\Media", false)).toBe("");
    expect(below(lines, "C:\\e", false)).toBe("");
    expect(below(lines, "C:\\f", false)).toBe("");
    expect(below(lines, "C:\\b", false)).toBe("C:\\f");
    expect(above(lines, "C:\\a", false)).toBe("C:\\Media");
    expect(below(linesEndingInLoading, "C:\\Users", false)).toBe("");
    expect(above(linesEndingInLoading, "C:\\Users", false)).toBe("C:\\notes.txt");
  });

  it("wraps a lone line onto itself", () => {
    const lines = buildFoldableGridLines(["a", "b"].map((name) => fileRow(`C:\\${name}`, 0, ROOT)), COLUMN_COUNTS);

    expect(below(lines, "C:\\b")).toBe("C:\\b");
    expect(above(lines, "C:\\a")).toBe("C:\\a");
  });

  it("skips loading lines, also when wrapping", () => {
    const lines = buildFoldableGridLines([
      folderRow("C:\\Users", 0, ROOT, { isExpanded: true, isLoadingChildren: true }),
      fileRow("C:\\notes.txt", 0, ROOT),
      folderRow("C:\\Temp", 0, ROOT, { isExpanded: true, isLoadingChildren: true }),
    ], COLUMN_COUNTS);

    expect(lines.map((line) => line.kind)).toEqual(["folder", "loading", "tiles", "folder", "loading"]);
    expect(below(lines, "C:\\Users")).toBe("C:\\notes.txt");
    expect(above(lines, "C:\\notes.txt")).toBe("C:\\Users");
    expect(below(lines, "C:\\Temp")).toBe("C:\\Users");
    expect(above(lines, "C:\\Users")).toBe("C:\\Temp");
  });

  it("returns '' for a path no line holds", () => {
    const lines = buildMediaLines({ isMediaOpen: false });

    expect(below(lines, "C:\\missing.txt")).toBe("");
    expect(above(lines, "")).toBe("");
    expect(below([], "C:\\a")).toBe("");
  });
});
