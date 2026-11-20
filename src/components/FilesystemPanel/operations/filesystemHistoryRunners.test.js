import { invoke } from "@tauri-apps/api/core";
import { getPathName } from "../hooks/filesystemEntryOperationUtils";
import { runRedo, runUndo } from "./filesystemHistoryRunners";
import {
  forgetPaneHistories,
  getPaneHistory,
  getPaneHistoryKey,
  pushMoveHistoryEntry,
  pushRenameHistoryEntry,
} from "./filesystemOperationHistory";
import {
  cancelFilesystemOperation,
  getTabOperations,
  resetFilesystemOperationQueue,
  startFilesystemOperationNow,
} from "./filesystemOperationQueue";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

const TAB_ID = "tab-1";
const PANE_KEY = getPaneHistoryKey(TAB_ID, "tab-1-left");

// Photos held a.jpg, b.jpg and c.jpg, which all merged into C:\Archive\Photos; the merge then
// removed the emptied Photos.
const MERGE_OF_THREE = {
  movedItems: ["a.jpg", "b.jpg", "c.jpg"].map((name) => ({
    sourcePath: `C:\\Users\\Photos\\${name}`,
    destinationPath: `C:\\Archive\\Photos\\${name}`,
  })),
  removedFolders: ["C:\\Users\\Photos"],
};

const lockedError = (path) => (
  `'${path}': The process cannot access the file because it is being used by another process. (os error 32)`
);

// Runs `intercept` before answering a call; throwing there fails the call.
function mockBackend(intercept = () => {}) {
  invoke.mockImplementation(async (command, payload) => {
    await intercept(command, payload);
    if (command === "move_path") return { destination: `${payload.destinationDir}\\${payload.targetName}`, merge: null };
    if (["recreate_folders", "remove_empty_folders", "rename_path", "filesystem_transfer_cancel"].includes(command)) return null;
    throw new Error(`Unhandled invoke: ${command}`);
  });
}

function historyCalls() {
  return invoke.mock.calls
    .filter(([command]) => ["move_path", "recreate_folders", "remove_empty_folders"].includes(command))
    .map(([command, payload]) => (command === "move_path"
      ? `move ${payload.source} -> ${payload.destinationDir}\\${payload.targetName}`
      : `${command} ${payload.paths.join(", ")}`));
}

// The names of each entry's items, oldest entry first.
function historyNames() {
  const { undo, redo } = getPaneHistory(PANE_KEY);
  const namesOf = (entries) => entries.map((entry) => entry.items.map((item) => getPathName(item.sourcePath)));
  return { undo: namesOf(undo), redo: namesOf(redo) };
}

function undo(pushNotification = undefined) {
  return startFilesystemOperationNow(TAB_ID, {
    label: "Undoing",
    paneKey: PANE_KEY,
    run: (operation) => runUndo(operation, pushNotification),
  });
}

function redo(pushNotification = undefined) {
  return startFilesystemOperationNow(TAB_ID, {
    label: "Redoing",
    paneKey: PANE_KEY,
    run: (operation) => runRedo(operation, pushNotification),
  });
}

describe("filesystemHistoryRunners", () => {
  afterEach(() => {
    resetFilesystemOperationQueue();
    forgetPaneHistories(new Set());
  });

  it("undoes a move by moving the items back in reverse order under their own names, and redoes it", async () => {
    const movedItems = [
      // Keep both had given it another name.
      { sourcePath: "C:\\Users\\a.txt", destinationPath: "C:\\Archive\\a (2).txt" },
      { sourcePath: "C:\\Users\\b.txt", destinationPath: "C:\\Archive\\b.txt" },
    ];
    pushMoveHistoryEntry(PANE_KEY, { movedItems, removedFolders: [] });
    mockBackend();

    expect(await undo()).toBe("done");
    const afterUndo = getPaneHistory(PANE_KEY);
    expect(afterUndo.undo).toEqual([]);
    expect(afterUndo.redo).toEqual([{ kind: "move", items: movedItems, removedFolders: [] }]);
    expect(await redo()).toBe("done");

    expect(historyCalls()).toEqual([
      "move C:\\Archive\\b.txt -> C:\\Users\\b.txt",
      "move C:\\Archive\\a (2).txt -> C:\\Users\\a.txt",
      "move C:\\Users\\a.txt -> C:\\Archive\\a (2).txt",
      "move C:\\Users\\b.txt -> C:\\Archive\\b.txt",
    ]);
    expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
      jobId: expect.stringMatching(/^filesystem-transfer-/),
      conflictPolicy: "fail",
    }));
    expect(getPaneHistory(PANE_KEY)).toEqual({
      undo: [{ kind: "move", items: movedItems, removedFolders: [] }],
      redo: [],
    });
  });

  it("recreates the folders a merge removed before moving its items back and removes them after a redo, within the operation", async () => {
    pushMoveHistoryEntry(PANE_KEY, MERGE_OF_THREE);
    const runningDuringFolderChanges = [];
    mockBackend((command) => {
      if (command === "recreate_folders" || command === "remove_empty_folders") {
        runningDuringFolderChanges.push(getTabOperations(TAB_ID).running?.label);
      }
    });

    expect(await undo()).toBe("done");
    expect(await redo()).toBe("done");

    expect(historyCalls()).toEqual([
      "recreate_folders C:\\Users\\Photos",
      "move C:\\Archive\\Photos\\c.jpg -> C:\\Users\\Photos\\c.jpg",
      "move C:\\Archive\\Photos\\b.jpg -> C:\\Users\\Photos\\b.jpg",
      "move C:\\Archive\\Photos\\a.jpg -> C:\\Users\\Photos\\a.jpg",
      "move C:\\Users\\Photos\\a.jpg -> C:\\Archive\\Photos\\a.jpg",
      "move C:\\Users\\Photos\\b.jpg -> C:\\Archive\\Photos\\b.jpg",
      "move C:\\Users\\Photos\\c.jpg -> C:\\Archive\\Photos\\c.jpg",
      "remove_empty_folders C:\\Users\\Photos",
    ]);
    expect(runningDuringFolderChanges).toEqual(["Undoing", "Redoing"]);
  });

  it("splits the entry when an undo is cancelled part way, so redo and undo go on from there", async () => {
    pushMoveHistoryEntry(PANE_KEY, MERGE_OF_THREE);
    let cancelOnce = true;
    mockBackend((command) => {
      // Cancel is clicked while the undo moves c.jpg back.
      if (cancelOnce && command === "move_path") {
        cancelOnce = false;
        cancelFilesystemOperation(TAB_ID, getTabOperations(TAB_ID).running.id);
      }
    });

    expect(await undo()).toBe("cancelled");
    expect(historyNames()).toEqual({ undo: [["a.jpg", "b.jpg"]], redo: [["c.jpg"]] });
    expect(await redo()).toBe("done");
    expect(historyNames()).toEqual({ undo: [["a.jpg", "b.jpg"], ["c.jpg"]], redo: [] });

    expect(historyCalls()).toEqual([
      "recreate_folders C:\\Users\\Photos",
      "move C:\\Archive\\Photos\\c.jpg -> C:\\Users\\Photos\\c.jpg",
      // The redo takes only c.jpg, which the cancelled undo moved back.
      "move C:\\Users\\Photos\\c.jpg -> C:\\Archive\\Photos\\c.jpg",
      "remove_empty_folders C:\\Users\\Photos",
    ]);
    // Both parts keep the removed folders.
    expect(getPaneHistory(PANE_KEY).undo.map((entry) => entry.removedFolders))
      .toEqual([["C:\\Users\\Photos"], ["C:\\Users\\Photos"]]);
  });

  it("splits the entry when a redo fails part way, shows Redo failed, and a retry goes on from there", async () => {
    pushMoveHistoryEntry(PANE_KEY, MERGE_OF_THREE);
    mockBackend();
    await undo();
    invoke.mockClear();
    let lockedOnce = true;
    mockBackend((command, payload) => {
      if (lockedOnce && command === "move_path" && payload.source === "C:\\Users\\Photos\\b.jpg") {
        lockedOnce = false;
        throw lockedError(payload.source);
      }
    });
    const pushNotification = vi.fn();

    expect(await redo(pushNotification)).toBe("failed");
    expect(historyNames()).toEqual({ undo: [["a.jpg"]], redo: [["b.jpg", "c.jpg"]] });
    expect(await redo()).toBe("done");
    expect(historyNames()).toEqual({ undo: [["a.jpg"], ["b.jpg", "c.jpg"]], redo: [] });

    expect(pushNotification).toHaveBeenCalledWith({
      title: "Redo failed",
      message: lockedError("C:\\Users\\Photos\\b.jpg"),
      tone: "error",
      takeFocus: false,
    });
    expect(historyCalls()).toEqual([
      "move C:\\Users\\Photos\\a.jpg -> C:\\Archive\\Photos\\a.jpg",
      "move C:\\Users\\Photos\\b.jpg -> C:\\Archive\\Photos\\b.jpg",
      // The retry starts at b.jpg, where the failed redo stopped.
      "move C:\\Users\\Photos\\b.jpg -> C:\\Archive\\Photos\\b.jpg",
      "move C:\\Users\\Photos\\c.jpg -> C:\\Archive\\Photos\\c.jpg",
      "remove_empty_folders C:\\Users\\Photos",
    ]);
  });

  it("keeps the whole entry to undo when an undo fails at its first item", async () => {
    pushMoveHistoryEntry(PANE_KEY, MERGE_OF_THREE);
    mockBackend((command, payload) => {
      if (command === "move_path" && payload.source === "C:\\Archive\\Photos\\c.jpg") throw lockedError(payload.source);
    });
    const pushNotification = vi.fn();

    expect(await undo(pushNotification)).toBe("failed");

    expect(historyNames()).toEqual({ undo: [["a.jpg", "b.jpg", "c.jpg"]], redo: [] });
    expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Undo failed",
      message: lockedError("C:\\Archive\\Photos\\c.jpg"),
      takeFocus: false,
    }));
  });

  it("undoes a merge that only removed folders once they are back, and keeps it when recreating them fails", async () => {
    pushMoveHistoryEntry(PANE_KEY, { movedItems: [], removedFolders: ["C:\\Users\\Photos\\2019", "C:\\Users\\Photos"] });
    let deniedOnce = true;
    mockBackend((command) => {
      if (deniedOnce && command === "recreate_folders") {
        deniedOnce = false;
        throw "Access is denied. (os error 5)";
      }
    });

    expect(await undo()).toBe("failed");
    expect(historyNames()).toEqual({ undo: [[]], redo: [] });
    expect(await undo()).toBe("done");
    expect(historyNames()).toEqual({ undo: [], redo: [[]] });
    expect(await redo()).toBe("done");
    expect(historyNames()).toEqual({ undo: [[]], redo: [] });

    expect(historyCalls()).toEqual([
      "recreate_folders C:\\Users\\Photos\\2019, C:\\Users\\Photos",
      "recreate_folders C:\\Users\\Photos\\2019, C:\\Users\\Photos",
      "remove_empty_folders C:\\Users\\Photos\\2019, C:\\Users\\Photos",
    ]);
  });

  it("undoes and redoes a rename, without progress, and keeps it when renaming back fails", async () => {
    pushRenameHistoryEntry(PANE_KEY, "C:\\Users\\todo.txt", "C:\\Users\\renamed.txt");
    const renameEntry = getPaneHistory(PANE_KEY).undo[0];
    let takenOnce = true;
    const progressDuringRenames = [];
    mockBackend((command) => {
      if (command !== "rename_path") return;
      progressDuringRenames.push(getTabOperations(TAB_ID).running.progress);
      if (takenOnce) {
        takenOnce = false;
        throw "Target already exists.";
      }
    });
    const pushNotification = vi.fn();

    expect(await undo(pushNotification)).toBe("failed");
    expect(getPaneHistory(PANE_KEY)).toEqual({ undo: [renameEntry], redo: [] });
    expect(await undo()).toBe("done");
    expect(getPaneHistory(PANE_KEY)).toEqual({ undo: [], redo: [renameEntry] });
    expect(await redo()).toBe("done");
    expect(getPaneHistory(PANE_KEY)).toEqual({ undo: [renameEntry], redo: [] });

    expect(pushNotification).toHaveBeenCalledWith({
      title: "Undo failed",
      message: "Target already exists.",
      tone: "error",
      takeFocus: false,
    });
    expect(invoke.mock.calls.filter(([command]) => command === "rename_path").map(([, payload]) => payload)).toEqual([
      { path: "C:\\Users\\renamed.txt", newName: "todo.txt", allowAdjustment: false },
      { path: "C:\\Users\\renamed.txt", newName: "todo.txt", allowAdjustment: false },
      { path: "C:\\Users\\todo.txt", newName: "renamed.txt", allowAdjustment: false },
    ]);
    // So the pane shows no Cancel for it.
    expect(progressDuringRenames).toEqual([null, null, null]);
  });

  it.each([
    ["move", "move_path", () => pushMoveHistoryEntry(PANE_KEY, {
      movedItems: [{ sourcePath: "C:\\Users\\a.txt", destinationPath: "C:\\Archive\\a.txt" }],
      removedFolders: [],
    })],
    ["rename", "rename_path", () => pushRenameHistoryEntry(PANE_KEY, "C:\\Users\\a.txt", "C:\\Users\\a2.txt")],
  ])("puts a redone %s below a rename made while it runs, so the next undo undoes the rename", async (_kind, redoCommand, pushEntry) => {
    pushEntry();
    const entry = getPaneHistory(PANE_KEY).undo[0];
    mockBackend();
    await undo();
    const redoGate = Promise.withResolvers();
    mockBackend((command) => (command === redoCommand ? redoGate.promise : undefined));

    const redoing = redo();
    // F2 in the pane while the redo runs.
    pushRenameHistoryEntry(PANE_KEY, "C:\\Users\\b.txt", "C:\\Users\\c.txt");
    const rename = getPaneHistory(PANE_KEY).undo.at(-1);
    redoGate.resolve();

    expect(await redoing).toBe("done");
    expect(getPaneHistory(PANE_KEY).undo).toEqual([entry, rename]);
  });

  it("replaces its own entry when a rename lands on top while it runs, so the next undo undoes the rename", async () => {
    pushMoveHistoryEntry(PANE_KEY, {
      movedItems: [{ sourcePath: "C:\\Users\\a.txt", destinationPath: "C:\\Archive\\a.txt" }],
      removedFolders: [],
    });
    const moveEntry = getPaneHistory(PANE_KEY).undo[0];
    const moveGate = Promise.withResolvers();
    mockBackend((command) => (command === "move_path" ? moveGate.promise : undefined));

    const undoing = undo();
    // F2 in the pane while the item moves back.
    pushRenameHistoryEntry(PANE_KEY, "C:\\Users\\b.txt", "C:\\Users\\c.txt");
    moveGate.resolve();

    expect(await undoing).toBe("done");
    expect(historyNames()).toEqual({ undo: [["b.txt"]], redo: [["a.txt"]] });
    expect(getPaneHistory(PANE_KEY).redo).toEqual([moveEntry]);
    expect(await undo()).toBe("done");
    expect(invoke).toHaveBeenLastCalledWith("rename_path", {
      path: "C:\\Users\\c.txt",
      newName: "b.txt",
      allowAdjustment: false,
    });
  });
});
