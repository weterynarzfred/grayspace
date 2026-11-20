import { act, fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import FilesystemOperationStatus, { describeTransferProgress } from "./FilesystemOperationStatus";
import {
  enqueueFilesystemOperation,
  getTabOperations,
  resetFilesystemOperationQueue,
  setOperationProgress,
} from "./filesystemOperationQueue";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

const TAB_ID = "tab-status";

// Enqueues an operation whose run waits until the test finishes it with an outcome.
function enqueueGated(label) {
  const gate = Promise.withResolvers();
  let finished;
  act(() => {
    finished = enqueueFilesystemOperation(TAB_ID, { label, paneKey: `${TAB_ID}::left`, run: () => gate.promise });
  });
  return {
    finish: async (outcome = "done") => {
      await act(async () => {
        gate.resolve(outcome);
        await finished;
      });
    },
  };
}

function getStatusLine() {
  return screen.getByRole("status", { name: "File operations" });
}

describe("FilesystemOperationStatus", () => {
  afterEach(() => {
    resetFilesystemOperationQueue();
  });

  it("shows nothing while the tab has no operations, nor for another tab's", () => {
    enqueueGated("Copying 2 items to \"Archive\"");

    render(<FilesystemOperationStatus tabId="other-tab" />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the label until there is progress, then the progress and Cancel, then Cancelling...", () => {
    enqueueGated('Moving 2 items to "Archive"');
    render(<FilesystemOperationStatus tabId={TAB_ID} />);

    // Waiting for its conflict answer: nothing to cancel in the header yet.
    expect(getStatusLine()).toHaveTextContent('Moving 2 items to "Archive"...');
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    const operation = getTabOperations(TAB_ID).running;
    act(() => {
      setOperationProgress(operation, { kind: "move", itemsDone: 1, itemsTotal: 2, bytesDone: 512, bytesTotal: 2048 });
    });
    expect(getStatusLine()).toHaveTextContent("Moving 2 of 2 items, 25% (512 B of 2.0 KB)...");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(invoke).toHaveBeenCalledWith("filesystem_transfer_cancel", { jobId: operation.id });
    expect(getStatusLine()).toHaveTextContent("Cancelling...");
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("counts the waiting operations, lists them in the tooltip and drops them on Cancel queued", () => {
    enqueueGated('Copying "a.txt" to "Archive"');
    enqueueGated('Moving 3 items to "Archive"');
    enqueueGated('Deleting "b.txt"');
    render(<FilesystemOperationStatus tabId={TAB_ID} />);

    expect(getStatusLine()).toHaveTextContent('Copying "a.txt" to "Archive"... · 2 queued');
    expect(screen.getByText(/2 queued/)).toHaveAttribute("title", 'Moving 3 items to "Archive"\nDeleting "b.txt"');

    fireEvent.click(screen.getByRole("button", { name: "Cancel queued" }));

    expect(getTabOperations(TAB_ID).queued).toEqual([]);
    expect(getStatusLine()).toHaveTextContent('Copying "a.txt" to "Archive"...');
    expect(screen.queryByText(/queued/)).not.toBeInTheDocument();
  });

  it("shows a paused queue with Resume, which runs the next operation", async () => {
    const first = enqueueGated('Copying "a.txt" to "Archive"');
    enqueueGated('Deleting "a.txt"');
    enqueueGated('Moving 3 items to "Archive"');
    render(<FilesystemOperationStatus tabId={TAB_ID} />);

    await first.finish("failed");

    expect(getStatusLine()).toHaveTextContent("Paused · 2 queued");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(getStatusLine()).toHaveTextContent('Deleting "a.txt"... · 1 queued');
    expect(screen.queryByRole("button", { name: "Resume" })).not.toBeInTheDocument();
  });
});

describe("describeTransferProgress", () => {
  it("names the item being worked on and the byte progress when known", () => {
    expect(describeTransferProgress({
      kind: "copy",
      itemsDone: 1,
      itemsTotal: 5,
      bytesDone: 1536,
      bytesTotal: 6144,
    })).toBe("Copying 2 of 5 items, 25% (1.5 KB of 6.0 KB)...");
    expect(describeTransferProgress({
      kind: "move",
      itemsDone: 0,
      itemsTotal: 1,
      bytesDone: 0,
      bytesTotal: 0,
    })).toBe("Moving...");
  });
});
