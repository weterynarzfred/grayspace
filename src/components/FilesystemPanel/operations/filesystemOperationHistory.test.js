import {
  forgetPaneHistories,
  getPaneHistory,
  getPaneHistoryKey,
  pushMoveHistoryEntry,
  pushRenameHistoryEntry,
  replaceHistoryEntry,
} from "./filesystemOperationHistory";

const LEFT_PANE = getPaneHistoryKey("tab-1", "tab-1-left");
const RIGHT_PANE = getPaneHistoryKey("tab-1", "tab-1-right");

function renameEntry(sourcePath, destinationPath) {
  return { kind: "rename", items: [{ sourcePath, destinationPath }] };
}

describe("filesystemOperationHistory", () => {
  afterEach(() => {
    forgetPaneHistories(new Set());
  });

  it("keeps one history per tab and pane id", () => {
    expect(LEFT_PANE).toBe("tab-1::tab-1-left");

    pushRenameHistoryEntry(LEFT_PANE, "C:\\Users\\a.txt", "C:\\Users\\b.txt");

    expect(getPaneHistory(LEFT_PANE)).toEqual({
      undo: [renameEntry("C:\\Users\\a.txt", "C:\\Users\\b.txt")],
      redo: [],
    });
    expect(getPaneHistory(RIGHT_PANE)).toEqual({ undo: [], redo: [] });
    expect(getPaneHistory(getPaneHistoryKey("tab-2", "tab-1-left")).undo).toEqual([]);
  });

  it("keeps the newest 100 entries per pane and clears redo on a push", () => {
    getPaneHistory(LEFT_PANE).redo.push(renameEntry("C:\\Users\\x.txt", "C:\\Users\\y.txt"));

    for (let index = 0; index <= 100; index += 1) {
      pushRenameHistoryEntry(LEFT_PANE, `C:\\Users\\${index}.txt`, `C:\\Users\\${index} renamed.txt`);
    }

    const { undo, redo } = getPaneHistory(LEFT_PANE);
    expect(undo).toHaveLength(100);
    expect(undo[0]).toEqual(renameEntry("C:\\Users\\1.txt", "C:\\Users\\1 renamed.txt"));
    expect(undo.at(-1)).toEqual(renameEntry("C:\\Users\\100.txt", "C:\\Users\\100 renamed.txt"));
    expect(redo).toEqual([]);
  });

  it("records what a move or a merge did and skips what changed nothing", () => {
    pushMoveHistoryEntry(LEFT_PANE, {
      movedItems: [{ sourcePath: "C:\\Users\\a.txt", destinationPath: "C:\\Archive\\a.txt" }],
      removedFolders: [],
    });
    pushMoveHistoryEntry(LEFT_PANE, { movedItems: [], removedFolders: [] });
    // A merge of empty folders into existing ones moves no items but removes the source folders.
    pushMoveHistoryEntry(LEFT_PANE, { movedItems: [], removedFolders: ["C:\\Users\\Photos"] });
    pushRenameHistoryEntry(LEFT_PANE, "C:\\Users\\b.txt", "C:\\Users\\b.txt");

    expect(getPaneHistory(LEFT_PANE).undo).toEqual([
      {
        kind: "move",
        items: [{ sourcePath: "C:\\Users\\a.txt", destinationPath: "C:\\Archive\\a.txt" }],
        removedFolders: [],
      },
      { kind: "move", items: [], removedFolders: ["C:\\Users\\Photos"] },
    ]);
  });

  it("replaces an entry by identity, leaving what landed on top of it in place", () => {
    const move = {
      kind: "move",
      items: [
        { sourcePath: "C:\\Users\\a.txt", destinationPath: "C:\\Archive\\a.txt" },
        { sourcePath: "C:\\Users\\b.txt", destinationPath: "C:\\Archive\\b.txt" },
      ],
      removedFolders: [],
    };
    const rename = renameEntry("C:\\Users\\c.txt", "C:\\Users\\d.txt");
    const notUndone = { ...move, items: [move.items[0]] };

    expect(replaceHistoryEntry([move, rename], move, [notUndone])).toEqual([notUndone, rename]);
    expect(replaceHistoryEntry([move, rename], move, [])).toEqual([rename]);
    expect(replaceHistoryEntry([{ ...move }, rename], move, [])).toHaveLength(2);
  });

  it("forgets the histories of panes no longer listed", () => {
    pushRenameHistoryEntry(LEFT_PANE, "C:\\Users\\a.txt", "C:\\Users\\b.txt");
    pushRenameHistoryEntry(RIGHT_PANE, "C:\\Users\\c.txt", "C:\\Users\\d.txt");

    forgetPaneHistories(new Set([LEFT_PANE]));

    expect(getPaneHistory(LEFT_PANE).undo).toHaveLength(1);
    expect(getPaneHistory(RIGHT_PANE).undo).toEqual([]);
  });
});
