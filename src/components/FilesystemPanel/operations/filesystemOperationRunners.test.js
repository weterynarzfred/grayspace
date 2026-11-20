import { invoke } from "@tauri-apps/api/core";
import { getPathName } from "../hooks/filesystemEntryOperationUtils";
import { forgetPaneHistories, getPaneHistory, getPaneHistoryKey } from "./filesystemOperationHistory";
import {
  cancelFilesystemOperation,
  enqueueFilesystemOperation,
  getTabOperations,
  resetFilesystemOperationQueue,
} from "./filesystemOperationQueue";
import { runCopy, runDelete, runMove } from "./filesystemOperationRunners";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

let emitProgress;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_eventName, handler) => {
    emitProgress = (payload) => handler({ payload });
    return () => {};
  }),
}));

const TAB_ID = "tab-1";
const PANE_KEY = getPaneHistoryKey(TAB_ID, "tab-1-left");

const lockedError = (path) => (
  `'${path}': The process cannot access the file because it is being used by another process. (os error 32)`
);

// Answers backend calls by command; any other command fails the call.
function mockBackend(handlers) {
  invoke.mockImplementation(async (command, payload) => {
    if (!handlers[command]) throw new Error(`Unhandled invoke: ${command}`);
    return handlers[command](payload);
  });
}

function movePlainly({ source, destinationDir }) {
  return { destination: `${destinationDir}\\${getPathName(source)}`, merge: null };
}

function cancelRunningOperation() {
  cancelFilesystemOperation(TAB_ID, getTabOperations(TAB_ID).running.id);
}

// Runs `runner` as an operation of the tab; resolves with its outcome and its record.
async function runAsOperation(runner, label = "Test operation") {
  let operation;
  const outcome = await enqueueFilesystemOperation(TAB_ID, {
    label,
    paneKey: PANE_KEY,
    run: (record) => {
      operation = record;
      return runner(record);
    },
  });
  return { outcome, operation };
}

function moveCalls() {
  return invoke.mock.calls
    .filter(([command]) => command === "move_path")
    .map(([, payload]) => `${payload.source} -> ${payload.destinationDir} (${payload.conflictPolicy})`);
}

describe("filesystemOperationRunners", () => {
  afterEach(() => {
    resetFilesystemOperationQueue();
    forgetPaneHistories(new Set());
  });

  describe("runMove", () => {
    it("moves each source under the operation's job id, records the move for undo and reports the moved sources", async () => {
      mockBackend({ filesystem_transfer_conflicts: () => [], move_path: movePlainly });

      const { outcome, operation } = await runAsOperation((record) => runMove(record, {
        sourcePaths: ["C:\\Users\\a.txt", "C:\\Users\\b.txt"],
        destinationDir: "C:\\Archive",
      }));

      expect(outcome).toBe("done");
      expect(invoke).toHaveBeenCalledWith("move_path", {
        source: "C:\\Users\\a.txt",
        destinationDir: "C:\\Archive",
        targetName: undefined,
        jobId: operation.id,
        conflictPolicy: "fail",
      });
      expect(moveCalls()).toEqual([
        "C:\\Users\\a.txt -> C:\\Archive (fail)",
        "C:\\Users\\b.txt -> C:\\Archive (fail)",
      ]);
      expect(operation.removedPaths).toEqual(["C:\\Users\\a.txt", "C:\\Users\\b.txt"]);
      expect(getPaneHistory(PANE_KEY).undo).toEqual([{
        kind: "move",
        items: [
          { sourcePath: "C:\\Users\\a.txt", destinationPath: "C:\\Archive\\a.txt" },
          { sourcePath: "C:\\Users\\b.txt", destinationPath: "C:\\Archive\\b.txt" },
        ],
        removedFolders: [],
      }]);
    });

    it("reports progress per item, starting the bytes over for each", async () => {
      const progressSeen = [];
      mockBackend({
        filesystem_transfer_conflicts: () => [],
        move_path: (payload) => {
          progressSeen.push(getTabOperations(TAB_ID).running.progress);
          // A cross-drive move reports the bytes of its item.
          emitProgress({ jobId: payload.jobId, bytesDone: 50, bytesTotal: 100, itemsDone: 0, itemsTotal: 1 });
          progressSeen.push(getTabOperations(TAB_ID).running.progress);
          return movePlainly(payload);
        },
      });

      await runAsOperation((record) => runMove(record, {
        sourcePaths: ["C:\\Users\\a.txt", "C:\\Users\\b.txt"],
        destinationDir: "D:\\Archive",
      }));

      expect(progressSeen).toEqual([
        { kind: "move", itemsDone: 0, itemsTotal: 2, bytesDone: 0, bytesTotal: 0 },
        { kind: "move", itemsDone: 0, itemsTotal: 2, bytesDone: 50, bytesTotal: 100 },
        { kind: "move", itemsDone: 1, itemsTotal: 2, bytesDone: 0, bytesTotal: 0 },
        { kind: "move", itemsDone: 1, itemsTotal: 2, bytesDone: 50, bytesTotal: 100 },
      ]);
    });

    it("moves nothing and records nothing when the conflict question is cancelled", async () => {
      mockBackend({ filesystem_transfer_conflicts: () => [{ path: "C:\\Users\\a.txt", mergesFolders: false }] });
      const openChoice = vi.fn(async () => null);

      const { outcome, operation } = await runAsOperation((record) => runMove(record, {
        sourcePaths: ["C:\\Users\\a.txt"],
        destinationDir: "C:\\Archive",
        openChoice,
      }));

      expect(outcome).toBe("cancelled");
      expect(openChoice).toHaveBeenCalledTimes(1);
      expect(moveCalls()).toEqual([]);
      expect(operation.removedPaths).toEqual([]);
      expect(getPaneHistory(PANE_KEY).undo).toEqual([]);
    });

    it("checks the conflicts of an operation that waited only when it starts, and asks without taking focus", async () => {
      const copyGate = Promise.withResolvers();
      mockBackend({
        filesystem_transfer_conflicts: () => [{ path: "C:\\Users\\a.txt", mergesFolders: false }],
        move_path: movePlainly,
      });
      const openChoice = vi.fn(async () => "keep-both");
      enqueueFilesystemOperation(TAB_ID, { label: "Copying", paneKey: PANE_KEY, run: () => copyGate.promise });

      const moveFinished = enqueueFilesystemOperation(TAB_ID, {
        label: 'Moving "a.txt" to "Archive"',
        paneKey: PANE_KEY,
        run: (operation) => runMove(operation, {
          sourcePaths: ["C:\\Users\\a.txt"],
          destinationDir: "C:\\Archive",
          openChoice,
        }),
      });
      expect(invoke).not.toHaveBeenCalled();
      copyGate.resolve("done");

      expect(await moveFinished).toBe("done");
      expect(openChoice).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Moving "a.txt" to "Archive": Item already exists',
        takeFocus: false,
        dismissOnOutside: false,
      }));
      expect(moveCalls()).toEqual(["C:\\Users\\a.txt -> C:\\Archive (keep-both)"]);
    });

    it("keeps what moved before an error for undo and shows a Move failed toast that leaves focus alone", async () => {
      mockBackend({
        filesystem_transfer_conflicts: () => [],
        move_path: (payload) => {
          if (payload.source === "C:\\Users\\b.txt") throw lockedError(payload.source);
          return movePlainly(payload);
        },
      });
      const pushNotification = vi.fn();

      const { outcome, operation } = await runAsOperation((record) => runMove(record, {
        sourcePaths: ["C:\\Users\\a.txt", "C:\\Users\\b.txt", "C:\\Users\\c.txt"],
        destinationDir: "C:\\Archive",
        pushNotification,
      }));

      expect(outcome).toBe("failed");
      expect(moveCalls()).toEqual([
        "C:\\Users\\a.txt -> C:\\Archive (fail)",
        "C:\\Users\\b.txt -> C:\\Archive (fail)",
      ]);
      expect(operation.removedPaths).toEqual(["C:\\Users\\a.txt"]);
      expect(getPaneHistory(PANE_KEY).undo[0].items).toEqual([
        { sourcePath: "C:\\Users\\a.txt", destinationPath: "C:\\Archive\\a.txt" },
      ]);
      expect(pushNotification).toHaveBeenCalledWith({
        title: "Move failed",
        message: lockedError("C:\\Users\\b.txt"),
        tone: "error",
        takeFocus: false,
      });
    });

    it("stops between items on Cancel and keeps what moved for undo, without a toast", async () => {
      mockBackend({
        filesystem_transfer_conflicts: () => [],
        filesystem_transfer_cancel: () => null,
        move_path: (payload) => {
          cancelRunningOperation();
          return movePlainly(payload);
        },
      });
      const pushNotification = vi.fn();

      const { outcome, operation } = await runAsOperation((record) => runMove(record, {
        sourcePaths: ["C:\\Users\\a.txt", "C:\\Users\\b.txt"],
        destinationDir: "C:\\Archive",
        pushNotification,
      }));

      expect(outcome).toBe("cancelled");
      expect(moveCalls()).toEqual(["C:\\Users\\a.txt -> C:\\Archive (fail)"]);
      expect(operation.removedPaths).toEqual(["C:\\Users\\a.txt"]);
      expect(getPaneHistory(PANE_KEY).undo[0].items).toEqual([
        { sourcePath: "C:\\Users\\a.txt", destinationPath: "C:\\Archive\\a.txt" },
      ]);
      expect(pushNotification).not.toHaveBeenCalled();
    });

    it("treats a cross-drive move that Cancel stopped in the backend as cancelled, not failed", async () => {
      mockBackend({
        filesystem_transfer_conflicts: () => [],
        filesystem_transfer_cancel: () => null,
        move_path: () => {
          cancelRunningOperation();
          throw "The transfer was cancelled.";
        },
      });
      const pushNotification = vi.fn();

      const { outcome, operation } = await runAsOperation((record) => runMove(record, {
        sourcePaths: ["C:\\Users\\a.txt"],
        destinationDir: "D:\\Archive",
        pushNotification,
      }));

      expect(outcome).toBe("cancelled");
      expect(invoke).toHaveBeenCalledWith("filesystem_transfer_cancel", { jobId: operation.id });
      expect(operation.removedPaths).toEqual([]);
      expect(getPaneHistory(PANE_KEY).undo).toEqual([]);
      expect(pushNotification).not.toHaveBeenCalled();
    });

    it("records each item a folder merge moved and the folders it removed", async () => {
      mockBackend({
        filesystem_transfer_conflicts: () => [{ path: "C:\\Users\\Photos", mergesFolders: true }],
        move_path: () => ({
          destination: "C:\\Archive\\Photos",
          merge: {
            movedItems: [{ sourcePath: "C:\\Users\\Photos\\new.jpg", destinationPath: "C:\\Archive\\Photos\\new.jpg" }],
            removedFolders: ["C:\\Users\\Photos"],
          },
        }),
      });

      const { outcome, operation } = await runAsOperation((record) => runMove(record, {
        sourcePaths: ["C:\\Users\\Photos"],
        destinationDir: "C:\\Archive",
        openChoice: async () => "replace",
      }));

      expect(outcome).toBe("done");
      expect(moveCalls()).toEqual(["C:\\Users\\Photos -> C:\\Archive (replace)"]);
      expect(operation.removedPaths).toEqual(["C:\\Users\\Photos"]);
      expect(getPaneHistory(PANE_KEY).undo).toEqual([{
        kind: "move",
        items: [{ sourcePath: "C:\\Users\\Photos\\new.jpg", destinationPath: "C:\\Archive\\Photos\\new.jpg" }],
        removedFolders: ["C:\\Users\\Photos"],
      }]);
    });

    it("moves the rest of a selection dropped onto one of its own folders into that folder", async () => {
      mockBackend({ filesystem_transfer_conflicts: () => [], move_path: movePlainly });

      const { outcome } = await runAsOperation((record) => runMove(record, {
        sourcePaths: ["C:\\Users\\Photos", "C:\\Users\\a.txt"],
        destinationDir: "C:\\Users\\Photos",
      }));

      expect(outcome).toBe("done");
      expect(moveCalls()).toEqual(["C:\\Users\\a.txt -> C:\\Users\\Photos (fail)"]);
    });
  });

  describe("runCopy", () => {
    it("copies in one backend call under the operation's job id, with progress, and records no history", async () => {
      let progressDuringCopy;
      mockBackend({
        filesystem_transfer_conflicts: () => [],
        import_paths: () => {
          progressDuringCopy = getTabOperations(TAB_ID).running.progress;
          return { copiedPaths: ["C:\\Archive\\a.txt", "C:\\Archive\\b.txt"], skippedPaths: [] };
        },
      });

      const { outcome, operation } = await runAsOperation((record) => runCopy(record, {
        sourcePaths: ["C:\\Users\\a.txt", "C:\\Users\\b.txt"],
        destinationDir: "C:\\Archive",
      }));

      expect(outcome).toBe("done");
      expect(invoke.mock.calls.filter(([command]) => command === "import_paths")).toEqual([["import_paths", {
        paths: ["C:\\Users\\a.txt", "C:\\Users\\b.txt"],
        destinationDir: "C:\\Archive",
        jobId: operation.id,
        conflictPolicy: "fail",
      }]]);
      expect(progressDuringCopy).toEqual({ kind: "copy", itemsDone: 0, itemsTotal: 2, bytesDone: 0, bytesTotal: 0 });
      expect(operation.removedPaths).toEqual([]);
      expect(getPaneHistory(PANE_KEY).undo).toEqual([]);
    });

    it("copies nothing and is done when Skip leaves nothing to copy", async () => {
      mockBackend({ filesystem_transfer_conflicts: () => [{ path: "C:\\Users\\a.txt", mergesFolders: false }] });

      const { outcome } = await runAsOperation((record) => runCopy(record, {
        sourcePaths: ["C:\\Users\\a.txt"],
        destinationDir: "C:\\Archive",
        openChoice: async () => "skip",
      }));

      expect(outcome).toBe("done");
      expect(invoke).not.toHaveBeenCalledWith("import_paths", expect.anything());
    });

    it("shows its failure under Copy failed, or the title given for an import, without taking focus", async () => {
      mockBackend({
        filesystem_transfer_conflicts: () => [],
        import_paths: () => {
          throw "Access is denied. (os error 5)";
        },
      });
      const pushNotification = vi.fn();
      const copyOptions = { sourcePaths: ["D:\\Downloads\\clip.mp4"], destinationDir: "C:\\Users", pushNotification };

      const copy = await runAsOperation((record) => runCopy(record, copyOptions));
      const importing = await runAsOperation((record) => runCopy(record, {
        ...copyOptions,
        errorTitle: "Import failed",
        fallbackMessage: "Failed to import dropped items.",
      }));

      expect(copy.outcome).toBe("failed");
      expect(importing.outcome).toBe("failed");
      expect(pushNotification.mock.calls).toEqual([
        [{ title: "Copy failed", message: "Access is denied. (os error 5)", tone: "error", takeFocus: false }],
        [{ title: "Import failed", message: "Access is denied. (os error 5)", tone: "error", takeFocus: false }],
      ]);
    });

    it("is cancelled without a toast when Cancel stops the backend copy", async () => {
      mockBackend({
        filesystem_transfer_conflicts: () => [],
        filesystem_transfer_cancel: () => null,
        import_paths: () => {
          cancelRunningOperation();
          throw "The transfer was cancelled.";
        },
      });
      const pushNotification = vi.fn();

      const { outcome, operation } = await runAsOperation((record) => runCopy(record, {
        sourcePaths: ["C:\\Users\\a.txt"],
        destinationDir: "D:\\Archive",
        pushNotification,
      }));

      expect(outcome).toBe("cancelled");
      expect(invoke).toHaveBeenCalledWith("filesystem_transfer_cancel", { jobId: operation.id });
      expect(pushNotification).not.toHaveBeenCalled();
    });

    it("withdraws the open conflict question of a copy on Cancel, and copies nothing", async () => {
      mockBackend({
        filesystem_transfer_conflicts: () => [{ path: "C:\\Users\\a.txt", mergesFolders: false }],
        filesystem_transfer_cancel: () => null,
      });
      // Like notificationCenter's openChoice: a withdrawn question resolves with null.
      const openChoice = vi.fn(({ signal }) => new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve(null));
      }));

      const copying = runAsOperation((record) => runCopy(record, {
        sourcePaths: ["C:\\Users\\a.txt"],
        destinationDir: "C:\\Archive",
        openChoice,
      }));
      await vi.waitFor(() => expect(openChoice).toHaveBeenCalledTimes(1));
      // E.g. closing the tab, which waits for the copy to stop.
      cancelRunningOperation();

      expect((await copying).outcome).toBe("cancelled");
      expect(invoke).not.toHaveBeenCalledWith("import_paths", expect.anything());
    });
  });

  describe("runDelete", () => {
    it("sends the paths to the Recycle Bin and reports them removed", async () => {
      mockBackend({ delete_paths: () => null });

      const { outcome, operation } = await runAsOperation((record) => runDelete(record, {
        paths: ["C:\\Users\\a.txt", "C:\\Users\\Photos"],
      }));

      expect(outcome).toBe("done");
      expect(invoke).toHaveBeenCalledWith("delete_paths", { paths: ["C:\\Users\\a.txt", "C:\\Users\\Photos"] });
      expect(operation.removedPaths).toEqual(["C:\\Users\\a.txt", "C:\\Users\\Photos"]);
      expect(operation.progress).toBeNull();
    });

    it("shows a Delete failed toast that leaves focus alone and reports nothing removed", async () => {
      mockBackend({
        delete_paths: () => {
          throw "Access is denied. (os error 5)";
        },
      });
      const pushNotification = vi.fn();

      const { outcome, operation } = await runAsOperation((record) => runDelete(record, {
        paths: ["C:\\Users\\a.txt"],
        pushNotification,
      }));

      expect(outcome).toBe("failed");
      expect(operation.removedPaths).toEqual([]);
      expect(pushNotification).toHaveBeenCalledWith({
        title: "Delete failed",
        message: "Access is denied. (os error 5)",
        tone: "error",
        takeFocus: false,
      });
    });
  });
});
