import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { describeTransferProgress } from "../FilesystemStatusMessages";
import useFilesystemTransfers from "./useFilesystemTransfers";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

let emitProgress;

describe("useFilesystemTransfers", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    listen.mockImplementation(async (_eventName, handler) => {
      emitProgress = (payload) => act(() => handler({ payload }));
      return () => {};
    });
  });

  it("transfers everything without asking when no names conflict", async () => {
    invoke.mockResolvedValue([]);
    const openChoice = vi.fn();
    const { result } = renderHook(() => useFilesystemTransfers({ openChoice }));

    const resolved = await result.current.resolveConflicts(["C:\\a.txt"], "D:\\Target");

    expect(invoke).toHaveBeenCalledWith("filesystem_transfer_conflicts", {
      sources: ["C:\\a.txt"],
      destinationDir: "D:\\Target",
    });
    expect(openChoice).not.toHaveBeenCalled();
    expect(resolved).toEqual({ sourcePaths: ["C:\\a.txt"], conflictPolicy: "fail" });
  });

  it("asks about conflicts and maps the answer to sources and a policy", async () => {
    invoke.mockResolvedValue(["C:\\a.txt"]);
    const openChoice = vi.fn();
    const { result } = renderHook(() => useFilesystemTransfers({ openChoice }));
    const sources = ["C:\\a.txt", "C:\\b.txt"];

    openChoice.mockResolvedValueOnce("replace");
    expect(await result.current.resolveConflicts(sources, "D:\\Target"))
      .toEqual({ sourcePaths: sources, conflictPolicy: "replace" });

    openChoice.mockResolvedValueOnce("skip");
    expect(await result.current.resolveConflicts(sources, "D:\\Target"))
      .toEqual({ sourcePaths: ["C:\\b.txt"], conflictPolicy: "fail" });

    openChoice.mockResolvedValueOnce(null);
    expect(await result.current.resolveConflicts(sources, "D:\\Target")).toBeNull();

    expect(openChoice).toHaveBeenCalledWith(expect.objectContaining({
      title: "Item already exists",
      message: expect.stringContaining('a.txt already exists in "Target"'),
      choices: [
        { id: "replace", label: "Replace" },
        { id: "keep-both", label: "Keep both" },
        { id: "skip", label: "Skip" },
      ],
    }));
  });

  it("tracks progress events of the active job and cancels it", async () => {
    invoke.mockResolvedValue(null);
    const { result } = renderHook(() => useFilesystemTransfers({}));

    let transfer;
    act(() => {
      transfer = result.current.beginTransfer("copy", 3);
    });
    await emitProgress({ jobId: "other-job", bytesDone: 9, bytesTotal: 9, itemsDone: 3, itemsTotal: 3 });
    await emitProgress({ jobId: transfer.jobId, bytesDone: 512, bytesTotal: 2048, itemsDone: 1, itemsTotal: 3 });

    expect(result.current.transferProgress).toEqual({
      kind: "copy",
      itemsDone: 1,
      itemsTotal: 3,
      bytesDone: 512,
      bytesTotal: 2048,
    });

    act(() => result.current.cancelTransfer());
    expect(transfer.cancelRequested).toBe(true);
    expect(invoke).toHaveBeenCalledWith("filesystem_transfer_cancel", { jobId: transfer.jobId });

    act(() => result.current.endTransfer());
    expect(result.current.transferProgress).toBeNull();
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
