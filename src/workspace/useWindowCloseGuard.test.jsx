import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  enqueueFilesystemOperation,
  getTabOperations,
  hasFilesystemOperations,
  resetFilesystemOperationQueue,
} from "../components/FilesystemPanel/operations/filesystemOperationQueue";
import useWindowCloseGuard from "./useWindowCloseGuard";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
}));

// The operation queue listens to transfer progress while it has operations.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

let closeRequestedHandler;
let unlistenCloseRequested;

// A file operation of the tab that runs until the test ends it with an outcome.
function startGatedOperation(tabId, label) {
  const gate = Promise.withResolvers();
  const finished = enqueueFilesystemOperation(tabId, {
    label,
    paneKey: `${tabId}::left`,
    run: () => gate.promise,
  });
  return { finished, finish: (outcome) => gate.resolve(outcome) };
}

// Does what Tauri's wrapper does with the handler: it destroys the window once the handler has
// returned, unless the handler prevented the close.
async function requestWindowClose() {
  let isPrevented = false;
  await closeRequestedHandler({ preventDefault: () => { isPrevented = true; } });
  return isPrevented ? "kept" : "closed";
}

describe("useWindowCloseGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unlistenCloseRequested = vi.fn();
    getCurrentWindow.mockReturnValue({
      onCloseRequested: vi.fn(async (handler) => {
        closeRequestedHandler = handler;
        return unlistenCloseRequested;
      }),
    });
  });

  afterEach(() => {
    resetFilesystemOperationQueue();
  });

  it("lets an idle window close without asking", async () => {
    const openConfirm = vi.fn();
    renderHook(() => useWindowCloseGuard(openConfirm));

    expect(await requestWindowClose()).toBe("closed");
    expect(openConfirm).not.toHaveBeenCalled();
  });

  it("asks, cancels the operations of every tab and lets the window close once the running ones have stopped", async () => {
    const openConfirm = vi.fn().mockResolvedValue(true);
    const copy = startGatedOperation("tab-a", "Copying");
    const move = startGatedOperation("tab-a", "Moving");
    const otherCopy = startGatedOperation("tab-b", "Copying");
    const copyOperation = getTabOperations("tab-a").running;
    const otherCopyOperation = getTabOperations("tab-b").running;
    renderHook(() => useWindowCloseGuard(openConfirm));
    let closeOutcome = "";

    const closing = requestWindowClose().then((outcome) => {
      closeOutcome = outcome;
    });

    expect(openConfirm).toHaveBeenCalledWith(expect.objectContaining({
      confirmLabel: "Cancel them and close",
      cancelLabel: "Keep window",
    }));
    expect(await move.finished).toBe("dropped");
    expect(copyOperation.cancelRequested).toBe(true);
    expect(otherCopyOperation.cancelRequested).toBe(true);
    expect(invoke).toHaveBeenCalledWith("filesystem_transfer_cancel", { jobId: copyOperation.id });
    expect(invoke).toHaveBeenCalledWith("filesystem_transfer_cancel", { jobId: otherCopyOperation.id });

    copy.finish("cancelled");
    await copy.finished;
    expect(closeOutcome).toBe("");
    otherCopy.finish("cancelled");
    await closing;

    expect(closeOutcome).toBe("closed");
    expect(hasFilesystemOperations()).toBe(false);
  });

  it("prevents the close when the user keeps the window, and leaves its operations alone", async () => {
    const openConfirm = vi.fn().mockResolvedValue(false);
    startGatedOperation("tab-a", "Copying");
    startGatedOperation("tab-a", "Moving");
    renderHook(() => useWindowCloseGuard(openConfirm));

    expect(await requestWindowClose()).toBe("kept");
    expect(openConfirm).toHaveBeenCalledTimes(1);
    expect(getTabOperations("tab-a").running.cancelRequested).toBe(false);
    expect(getTabOperations("tab-a").queued).toHaveLength(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  // Each request has its own wrapper: one that returned would destroy the window in the middle of
  // the first one's wait.
  it("prevents another close request while one asks or waits, and asks again once the window was kept", async () => {
    const keep = Promise.withResolvers();
    const openConfirm = vi.fn().mockReturnValueOnce(keep.promise).mockResolvedValueOnce(true);
    const copy = startGatedOperation("tab-a", "Copying");
    const copyOperation = getTabOperations("tab-a").running;
    renderHook(() => useWindowCloseGuard(openConfirm));

    const kept = requestWindowClose();
    const whileAsking = requestWindowClose();
    expect(openConfirm).toHaveBeenCalledTimes(1);
    expect(await whileAsking).toBe("kept");
    keep.resolve(false);
    expect(await kept).toBe("kept");

    const closing = requestWindowClose();
    expect(openConfirm).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(copyOperation.cancelRequested).toBe(true));
    const whileWaiting = requestWindowClose();
    expect(openConfirm).toHaveBeenCalledTimes(2);
    expect(await whileWaiting).toBe("kept");
    copy.finish("cancelled");

    expect(await closing).toBe("closed");
  });

  // The open question holds back only a close that has something to cancel.
  it("lets the window close at once when its operations ended while the first close asks", async () => {
    const answer = Promise.withResolvers();
    const openConfirm = vi.fn().mockReturnValueOnce(answer.promise);
    const copy = startGatedOperation("tab-a", "Copying");
    renderHook(() => useWindowCloseGuard(openConfirm));

    const asking = requestWindowClose();
    copy.finish("done");
    await copy.finished;

    expect(await requestWindowClose()).toBe("closed");
    expect(openConfirm).toHaveBeenCalledTimes(1);
    answer.resolve(false);
    await asking;
  });

  it("stops listening when unmounted", async () => {
    const { unmount } = renderHook(() => useWindowCloseGuard(vi.fn()));

    unmount();

    await waitFor(() => expect(unlistenCloseRequested).toHaveBeenCalledTimes(1));
  });
});
