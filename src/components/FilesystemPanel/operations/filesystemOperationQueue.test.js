import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  cancelAllFilesystemOperations,
  cancelFilesystemOperation,
  cancelQueuedFilesystemOperations,
  cancelTabFilesystemOperations,
  enqueueFilesystemOperation,
  getTabOperations,
  hasFilesystemOperations,
  onFilesystemOperationFinished,
  resetFilesystemOperationQueue,
  resumeFilesystemOperations,
  setOperationProgress,
  startFilesystemOperationNow,
  subscribeToFilesystemOperations,
} from "./filesystemOperationQueue";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

let emitProgress;
let unlistenProgress;

// A run that waits until the test finishes it with an outcome.
function createGatedRun() {
  const gate = Promise.withResolvers();
  return {
    run: vi.fn(() => gate.promise),
    finish: (outcome = "done") => gate.resolve(outcome),
  };
}

function enqueue(tabId, label, run) {
  return enqueueFilesystemOperation(tabId, { label, paneKey: `${tabId}::left`, run });
}

function queuedLabels(tabId) {
  return getTabOperations(tabId).queued.map(({ label }) => label);
}

// Starts First and Second in the tab, then ends First with `outcome` while Second waits.
async function endFirstWhileSecondWaits(tabId, outcome) {
  const first = createGatedRun();
  const second = createGatedRun();
  const firstFinished = enqueue(tabId, "First", first.run);
  const secondFinished = enqueue(tabId, "Second", second.run);
  first.finish(outcome);
  await firstFinished;
  return { second, secondFinished };
}

describe("filesystemOperationQueue", () => {
  beforeEach(() => {
    unlistenProgress = vi.fn();
    listen.mockImplementation(async (_eventName, handler) => {
      emitProgress = (payload) => handler({ payload });
      return unlistenProgress;
    });
  });

  afterEach(() => {
    resetFilesystemOperationQueue();
  });

  it("runs a tab's operations one at a time in order, while another tab's run alongside", async () => {
    const first = createGatedRun();
    const second = createGatedRun();
    const other = createGatedRun();

    const firstFinished = enqueue("tab-a", "First", first.run);
    const secondFinished = enqueue("tab-a", "Second", second.run);
    enqueue("tab-b", "Other", other.run);

    expect(first.run).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^filesystem-transfer-/),
      tabId: "tab-a",
      paneKey: "tab-a::left",
      label: "First",
    }));
    expect(second.run).not.toHaveBeenCalled();
    expect(other.run).toHaveBeenCalledTimes(1);
    expect(getTabOperations("tab-a").running.label).toBe("First");
    expect(queuedLabels("tab-a")).toEqual(["Second"]);

    first.finish();
    expect(await firstFinished).toBe("done");
    expect(second.run).toHaveBeenCalledTimes(1);
    expect(getTabOperations("tab-a").running.label).toBe("Second");
    expect(queuedLabels("tab-a")).toEqual([]);

    second.finish();
    expect(await secondFinished).toBe("done");
    expect(hasFilesystemOperations("tab-a")).toBe(false);
    expect(hasFilesystemOperations("tab-b")).toBe(true);
    expect(hasFilesystemOperations()).toBe(true);
  });

  it("marks an operation that had to wait as startsLater, and one started in an idle tab as not", async () => {
    const first = createGatedRun();
    const second = createGatedRun();
    const firstFinished = enqueue("tab", "First", first.run);
    enqueue("tab", "Second", second.run);

    first.finish();
    await firstFinished;

    expect(first.run.mock.calls[0][0].startsLater).toBe(false);
    expect(second.run.mock.calls[0][0].startsLater).toBe(true);
  });

  it("drops a waiting operation without running it, without pausing and without a finish event", async () => {
    const finishedOperations = [];
    onFilesystemOperationFinished((operation) => finishedOperations.push(operation.label));
    const first = createGatedRun();
    const second = createGatedRun();
    const third = createGatedRun();
    const firstFinished = enqueue("tab", "First", first.run);
    const secondFinished = enqueue("tab", "Second", second.run);
    enqueue("tab", "Third", third.run);

    cancelFilesystemOperation("tab", getTabOperations("tab").queued[0].id);

    expect(await secondFinished).toBe("dropped");
    expect(queuedLabels("tab")).toEqual(["Third"]);
    expect(getTabOperations("tab").running.cancelRequested).toBe(false);
    first.finish();
    await firstFinished;
    expect(second.run).not.toHaveBeenCalled();
    expect(third.run).toHaveBeenCalledTimes(1);
    expect(finishedOperations).toEqual(["First"]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("asks the backend to stop the running operation's job, ignoring a failure to reach it", async () => {
    invoke.mockRejectedValueOnce(new Error("The window is closing."));
    const copy = createGatedRun();
    const copyFinished = enqueue("tab", "Copying", copy.run);
    const operation = getTabOperations("tab").running;
    const entryBeforeCancel = getTabOperations("tab");

    cancelFilesystemOperation("tab", operation.id);

    expect(operation.cancelRequested).toBe(true);
    // A new entry, so the tab's status line shows "Cancelling...".
    expect(getTabOperations("tab")).not.toBe(entryBeforeCancel);
    expect(invoke).toHaveBeenCalledWith("filesystem_transfer_cancel", { jobId: operation.id });
    copy.finish("cancelled");
    expect(await copyFinished).toBe("cancelled");
  });

  it("aborts the running operation's signal on Cancel, which withdraws a conflict question it waits on", async () => {
    const copy = createGatedRun();
    const copyFinished = enqueue("tab", "Copying", copy.run);
    const operation = getTabOperations("tab").running;
    expect(operation.abortController.signal.aborted).toBe(false);

    cancelFilesystemOperation("tab", operation.id);

    expect(operation.abortController.signal.aborted).toBe(true);
    copy.finish("cancelled");
    expect(await copyFinished).toBe("cancelled");
  });

  it.each(["failed", "cancelled"])("pauses the tab when the running operation is %s while others wait, until Resume", async (outcome) => {
    const { second, secondFinished } = await endFirstWhileSecondWaits("tab", outcome);

    expect(getTabOperations("tab")).toMatchObject({ running: null, paused: true });
    expect(second.run).not.toHaveBeenCalled();
    // What is started meanwhile waits too.
    const later = createGatedRun();
    enqueue("tab", "Later", later.run);
    expect(later.run).not.toHaveBeenCalled();
    expect(queuedLabels("tab")).toEqual(["Second", "Later"]);

    resumeFilesystemOperations("tab");

    expect(getTabOperations("tab").paused).toBe(false);
    expect(second.run).toHaveBeenCalledTimes(1);
    second.finish();
    expect(await secondFinished).toBe("done");
    expect(later.run).toHaveBeenCalledTimes(1);
  });

  it("does not pause when nothing waits behind a failed operation", async () => {
    const copy = createGatedRun();
    const copyFinished = enqueue("tab", "Copying", copy.run);

    copy.finish("failed");

    expect(await copyFinished).toBe("failed");
    expect(hasFilesystemOperations("tab")).toBe(false);
    const next = createGatedRun();
    enqueue("tab", "Next", next.run);
    expect(next.run).toHaveBeenCalledTimes(1);
  });

  it("Cancel queued drops the waiting operations and ends the pause", async () => {
    const { second, secondFinished } = await endFirstWhileSecondWaits("tab", "failed");
    const third = createGatedRun();
    const thirdFinished = enqueue("tab", "Third", third.run);

    cancelQueuedFilesystemOperations("tab");

    expect(await secondFinished).toBe("dropped");
    expect(await thirdFinished).toBe("dropped");
    expect(second.run).not.toHaveBeenCalled();
    expect(third.run).not.toHaveBeenCalled();
    expect(hasFilesystemOperations("tab")).toBe(false);
    const next = createGatedRun();
    enqueue("tab", "Next", next.run);
    expect(next.run).toHaveBeenCalledTimes(1);
  });

  it("ends a pause once its last waiting operation is taken back", async () => {
    const { secondFinished } = await endFirstWhileSecondWaits("tab", "failed");

    cancelFilesystemOperation("tab", getTabOperations("tab").queued[0].id);

    expect(await secondFinished).toBe("dropped");
    expect(hasFilesystemOperations("tab")).toBe(false);
  });

  it("starts undo and redo ahead of a paused queue and leaves it paused", async () => {
    const { second } = await endFirstWhileSecondWaits("tab", "cancelled");
    const undo = createGatedRun();

    const undoFinished = startFilesystemOperationNow("tab", { label: "Undoing", paneKey: "tab::left", run: undo.run });

    expect(undo.run).toHaveBeenCalledWith(expect.objectContaining({ label: "Undoing", startsLater: false }));
    expect(getTabOperations("tab")).toMatchObject({ running: { label: "Undoing" }, paused: true });
    undo.finish();
    expect(await undoFinished).toBe("done");
    expect(getTabOperations("tab")).toMatchObject({ running: null, paused: true });
    expect(second.run).not.toHaveBeenCalled();
  });

  it("routes progress events to the running operation with that job id, and listens only while the window has operations", async () => {
    expect(listen).not.toHaveBeenCalled();
    const copy = createGatedRun();
    const move = createGatedRun();
    const copyFinished = enqueue("tab-a", "Copying", copy.run);
    const moveFinished = enqueue("tab-b", "Moving", move.run);
    expect(listen).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith("filesystem-transfer-progress", expect.any(Function));

    const copyOperation = getTabOperations("tab-a").running;
    const moveOperation = getTabOperations("tab-b").running;
    setOperationProgress(copyOperation, { kind: "copy", itemsDone: 0, itemsTotal: 3, bytesDone: 0, bytesTotal: 0 });
    setOperationProgress(moveOperation, { kind: "move", itemsDone: 1, itemsTotal: 2, bytesDone: 0, bytesTotal: 0 });
    const onChange = vi.fn();
    subscribeToFilesystemOperations(onChange);
    const entryBeforeEvent = getTabOperations("tab-a");

    // A job of another window: Rust sends progress to every window.
    emitProgress({ jobId: "filesystem-transfer-elsewhere", bytesDone: 9, bytesTotal: 9, itemsDone: 3, itemsTotal: 3 });
    expect(onChange).not.toHaveBeenCalled();
    emitProgress({ jobId: copyOperation.id, bytesDone: 512, bytesTotal: 2048, itemsDone: 1, itemsTotal: 3 });
    emitProgress({ jobId: moveOperation.id, bytesDone: 10, bytesTotal: 40, itemsDone: 0, itemsTotal: 1 });

    expect(getTabOperations("tab-a")).not.toBe(entryBeforeEvent);
    expect(getTabOperations("tab-a").running.progress).toEqual({
      kind: "copy",
      itemsDone: 1,
      itemsTotal: 3,
      bytesDone: 512,
      bytesTotal: 2048,
    });
    // Each move call moves one item, so the move keeps its own item count.
    expect(getTabOperations("tab-b").running.progress).toEqual({
      kind: "move",
      itemsDone: 1,
      itemsTotal: 2,
      bytesDone: 10,
      bytesTotal: 40,
    });
    expect(onChange).toHaveBeenCalledTimes(2);

    copy.finish();
    await copyFinished;
    expect(unlistenProgress).not.toHaveBeenCalled();
    move.finish();
    await moveFinished;
    expect(unlistenProgress).toHaveBeenCalledTimes(1);

    const next = createGatedRun();
    enqueue("tab-a", "Next", next.run);
    expect(listen).toHaveBeenCalledTimes(2);
  });

  it("keeps a stable snapshot between changes and one shared snapshot for idle tabs", () => {
    const idleSnapshot = getTabOperations("tab-a");
    expect(getTabOperations("tab-b")).toBe(idleSnapshot);
    expect(idleSnapshot).toEqual({ running: null, queued: [], paused: false });

    enqueue("tab-a", "Copying", createGatedRun().run);

    expect(getTabOperations("tab-a")).toBe(getTabOperations("tab-a"));
    expect(getTabOperations("tab-a")).not.toBe(idleSnapshot);
  });

  it("notifies subscribers of every change until they unsubscribe", async () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeToFilesystemOperations(onChange);
    const copy = createGatedRun();

    const copyFinished = enqueue("tab", "Copying", copy.run);
    expect(onChange).toHaveBeenCalled();
    onChange.mockClear();
    copy.finish();
    await copyFinished;
    expect(onChange).toHaveBeenCalled();

    unsubscribe();
    onChange.mockClear();
    enqueue("tab", "Next", createGatedRun().run);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("cancelTabFilesystemOperations drops the waiting ones and resolves only once the running one has stopped", async () => {
    const copy = createGatedRun();
    const move = createGatedRun();
    enqueue("tab", "Copying", copy.run);
    const moveFinished = enqueue("tab", "Moving", move.run);
    const copyOperation = getTabOperations("tab").running;
    let hasStopped = false;

    const stopping = cancelTabFilesystemOperations("tab").then(() => {
      hasStopped = true;
    });

    expect(await moveFinished).toBe("dropped");
    expect(copyOperation.cancelRequested).toBe(true);
    expect(invoke).toHaveBeenCalledWith("filesystem_transfer_cancel", { jobId: copyOperation.id });
    expect(hasStopped).toBe(false);
    copy.finish("cancelled");
    await stopping;
    expect(move.run).not.toHaveBeenCalled();
    expect(hasFilesystemOperations()).toBe(false);
  });

  // The tab stays usable while a close waits for its running operation, e.g. a delete, which has no
  // Cancel. What the user starts meanwhile goes too.
  it("cancelTabFilesystemOperations also cancels an operation that starts in the tab while it waits", async () => {
    const deletion = createGatedRun();
    const copy = createGatedRun();
    const deletionFinished = enqueue("tab", "Deleting", deletion.run);
    let hasStopped = false;
    const stopping = cancelTabFilesystemOperations("tab").then(() => {
      hasStopped = true;
    });

    const copyFinished = enqueue("tab", "Copying", copy.run);
    deletion.finish("done");
    expect(await deletionFinished).toBe("done");

    // It started behind the delete, which ended without a pause.
    expect(getTabOperations("tab").running).toMatchObject({ label: "Copying", cancelRequested: true });
    expect(hasStopped).toBe(false);
    copy.finish("cancelled");
    await stopping;
    expect(await copyFinished).toBe("cancelled");
    expect(hasFilesystemOperations("tab")).toBe(false);
  });

  it("cancelTabFilesystemOperations also drops an operation queued while it waits, behind the paused tab", async () => {
    const move = createGatedRun();
    const copy = createGatedRun();
    enqueue("tab", "Moving", move.run);
    const stopping = cancelTabFilesystemOperations("tab");

    const copyFinished = enqueue("tab", "Copying", copy.run);
    move.finish("cancelled");
    await stopping;

    expect(hasFilesystemOperations("tab")).toBe(false);
    expect(await copyFinished).toBe("dropped");
    expect(copy.run).not.toHaveBeenCalled();
  });

  it("cancelAllFilesystemOperations also stops an operation that a tab without any starts while it waits", async () => {
    const deletion = createGatedRun();
    const copy = createGatedRun();
    enqueue("tab-a", "Deleting", deletion.run);
    let hasStopped = false;
    const stopping = cancelAllFilesystemOperations().then(() => {
      hasStopped = true;
    });

    const copyFinished = enqueue("tab-b", "Copying", copy.run);
    const copyOperation = getTabOperations("tab-b").running;
    deletion.finish("done");

    await vi.waitFor(() => expect(copyOperation.cancelRequested).toBe(true));
    expect(hasStopped).toBe(false);
    copy.finish("cancelled");
    await stopping;
    expect(await copyFinished).toBe("cancelled");
    expect(hasFilesystemOperations()).toBe(false);
  });

  it("cancelAllFilesystemOperations stops every tab's operations, and resolves at once without any", async () => {
    await cancelAllFilesystemOperations();
    const first = createGatedRun();
    const second = createGatedRun();
    const firstFinished = enqueue("tab-a", "First", first.run);
    enqueue("tab-b", "Second", second.run);
    const queuedFinished = enqueue("tab-b", "Queued", createGatedRun().run);
    let hasStopped = false;

    const stopping = cancelAllFilesystemOperations().then(() => {
      hasStopped = true;
    });

    expect(await queuedFinished).toBe("dropped");
    expect(getTabOperations("tab-a").running.cancelRequested).toBe(true);
    expect(getTabOperations("tab-b").running.cancelRequested).toBe(true);
    first.finish("cancelled");
    await firstFinished;
    expect(hasStopped).toBe(false);
    second.finish("cancelled");
    await stopping;
    expect(hasFilesystemOperations()).toBe(false);
  });

  it("tells finish listeners which tab's operation finished and what it removed, until they unsubscribe", async () => {
    const onFinished = vi.fn();
    const unsubscribe = onFilesystemOperationFinished(onFinished);

    await enqueue("tab", "Deleting", async (operation) => {
      operation.removedPaths = ["C:\\Users\\a.txt"];
      return "done";
    });
    await enqueue("other-tab", "Copying", async () => "failed");
    unsubscribe();
    await enqueue("tab", "Moving", async () => "done");

    expect(onFinished).toHaveBeenCalledTimes(2);
    expect(onFinished).toHaveBeenNthCalledWith(1, expect.objectContaining({
      tabId: "tab",
      removedPaths: ["C:\\Users\\a.txt"],
    }));
    expect(onFinished).toHaveBeenNthCalledWith(2, expect.objectContaining({ tabId: "other-tab", removedPaths: [] }));
  });

  it("frees the tab and settles failed when a runner throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const runnerError = new Error("A runner bug.");
    const next = createGatedRun();

    const brokenFinished = enqueue("tab", "Broken", async () => {
      throw runnerError;
    });
    enqueue("tab", "Next", next.run);

    expect(await brokenFinished).toBe("failed");
    expect(consoleError).toHaveBeenCalledWith(runnerError);
    // The next one waits for Resume, as behind any failed operation.
    expect(getTabOperations("tab")).toMatchObject({ running: null, paused: true });
    resumeFilesystemOperations("tab");
    expect(next.run).toHaveBeenCalledTimes(1);
  });
});
