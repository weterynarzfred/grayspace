import { invoke } from "@tauri-apps/api/core";
import { resolveConflicts } from "./transferConflicts";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// The fields of an operation record (filesystemOperationQueue) that resolveConflicts reads.
function createOperation({ label = 'Moving 2 items to "Target"', startsLater = false } = {}) {
  return { label, startsLater, cancelRequested: false, abortController: new AbortController() };
}

const STARTS_NOW = createOperation();

describe("resolveConflicts", () => {
  it("transfers everything without asking when no names conflict", async () => {
    invoke.mockResolvedValue([]);
    const openChoice = vi.fn();

    const resolved = await resolveConflicts(["C:\\a.txt"], "D:\\Target", openChoice, STARTS_NOW);

    expect(invoke).toHaveBeenCalledWith("filesystem_transfer_conflicts", {
      sources: ["C:\\a.txt"],
      destinationDir: "D:\\Target",
    });
    expect(openChoice).not.toHaveBeenCalled();
    expect(resolved).toEqual({ sourcePaths: ["C:\\a.txt"], conflictPolicy: "fail" });
  });

  it("asks about conflicts and maps the answer to sources and a policy", async () => {
    invoke.mockResolvedValue([{ path: "C:\\a.txt", mergesFolders: false }]);
    const openChoice = vi.fn();
    const sources = ["C:\\a.txt", "C:\\b.txt"];

    openChoice.mockResolvedValueOnce("replace");
    expect(await resolveConflicts(sources, "D:\\Target", openChoice, STARTS_NOW))
      .toEqual({ sourcePaths: sources, conflictPolicy: "replace" });

    openChoice.mockResolvedValueOnce("skip");
    expect(await resolveConflicts(sources, "D:\\Target", openChoice, STARTS_NOW))
      .toEqual({ sourcePaths: ["C:\\b.txt"], conflictPolicy: "fail" });

    openChoice.mockResolvedValueOnce(null);
    expect(await resolveConflicts(sources, "D:\\Target", openChoice, STARTS_NOW)).toBeNull();

    // An operation that starts at once asks as before: with focus, closed by a click elsewhere.
    // Cancelling the operation withdraws the question.
    expect(openChoice).toHaveBeenCalledWith({
      title: "Item already exists",
      message: 'a.txt already exists in "Target". Replaced items go to the Recycle Bin.',
      tone: "warning",
      choices: [
        { id: "replace", label: "Replace" },
        { id: "keep-both", label: "Keep both" },
        { id: "skip", label: "Skip" },
      ],
      takeFocus: true,
      dismissOnOutside: true,
      signal: STARTS_NOW.abortController.signal,
    });
  });

  it.each([
    ["no conflicts", []],
    ["a conflict", [{ path: "C:\\a.txt", mergesFolders: false }]],
  ])("transfers nothing and asks nothing when the operation was cancelled while its conflicts were looked up, with %s", async (_case, conflicts) => {
    const operation = createOperation();
    invoke.mockImplementation(async () => {
      // The user cancels, or closes the tab, meanwhile.
      operation.cancelRequested = true;
      return conflicts;
    });
    const openChoice = vi.fn(async () => "replace");

    expect(await resolveConflicts(["C:\\a.txt"], "D:\\Target", openChoice, operation)).toBeNull();
    expect(openChoice).not.toHaveBeenCalled();
  });

  it("tells that Replace merges folders when a folder lands on a folder", async () => {
    invoke.mockResolvedValue([
      { path: "C:\\notes.txt", mergesFolders: false },
      { path: "C:\\Photos", mergesFolders: true },
    ]);
    const openChoice = vi.fn(async () => "replace");
    const sources = ["C:\\notes.txt", "C:\\Photos"];

    expect(await resolveConflicts(sources, "D:\\Backup", openChoice, STARTS_NOW))
      .toEqual({ sourcePaths: sources, conflictPolicy: "replace" });
    expect(openChoice).toHaveBeenCalledWith(expect.objectContaining({
      title: "2 items already exist",
      message: 'notes.txt, Photos already exist in "Backup". '
        + "Replace merges folders into same-named folders and replaces same-named files inside them. "
        + "Replaced items go to the Recycle Bin.",
    }));
  });

  it("lists three names and counts the rest", async () => {
    invoke.mockResolvedValue(["a", "b", "c", "d", "e"].map((name) => ({ path: `C:\\${name}.txt`, mergesFolders: false })));
    const openChoice = vi.fn(async () => null);

    await resolveConflicts(["C:\\a.txt"], "D:\\Target", openChoice, STARTS_NOW);

    expect(openChoice).toHaveBeenCalledWith(expect.objectContaining({
      title: "5 items already exist",
      message: 'a.txt, b.txt, c.txt and 2 more already exist in "Target". Replaced items go to the Recycle Bin.',
    }));
  });

  it("passes takeFocus false and dismissOnOutside false to the prompt of an operation that waited, and names it in the title", async () => {
    invoke.mockResolvedValue([{ path: "C:\\a.txt", mergesFolders: false }]);
    const openChoice = vi.fn(async () => "keep-both");

    const resolved = await resolveConflicts(["C:\\a.txt"], "D:\\Target", openChoice, createOperation({
      label: 'Copying "a.txt" to "Target"',
      startsLater: true,
    }));

    expect(resolved).toEqual({ sourcePaths: ["C:\\a.txt"], conflictPolicy: "keep-both" });
    expect(openChoice).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Copying "a.txt" to "Target": Item already exists',
      takeFocus: false,
      dismissOnOutside: false,
    }));
  });
});
