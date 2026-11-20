import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import useFilesystemNavigation from "./useFilesystemNavigation";
import { getPaneHistory, getPaneHistoryKey } from "../operations/filesystemOperationHistory";
import {
  cancelFilesystemOperation,
  getTabOperations,
  hasFilesystemOperations,
} from "../operations/filesystemOperationQueue";
import { flushPromises, runInAsyncAct } from "../../../test/utils/actCallbacks";
import { advanceTimersBy } from "../../../test/utils/timers";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

let filesystemWatchHandler;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName, handler) => {
    if (eventName === "filesystem-watch-event")
      filesystemWatchHandler = runInAsyncAct(handler);
    return () => {
      filesystemWatchHandler = undefined;
    };
  }),
}));

function createDeferred() {
  let resolve;
  let reject;

  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function mockFilesystemInvoke({
  parentPathForUsers = "C:\\",
} = {}) {
  const directoryState = {
    "C:\\": [{ name: "Users", path: "C:\\Users", is_dir: true }],
    "C:\\Users": [{ name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false }],
  };

  invoke.mockImplementation(async (command, payload) => {
    if (command === "list_drives") {
      return [{ name: "C:", path: "C:\\" }];
    }

    if (command === "list_directory_page") {
      const path = payload?.path ?? "";
      const entries = directoryState[path] ?? [];
      const offset = payload?.offset ?? 0;
      const limit = payload?.limit ?? entries.length;
      const pageEntries = entries.slice(offset, offset + limit);
      return {
        entries: pageEntries,
        hasMore: offset + pageEntries.length < entries.length,
        totalCount: entries.length,
      };
    }

    if (command === "list_directory") {
      return directoryState[payload?.path ?? ""] ?? [];
    }

    if (command === "parent_path") {
      if (payload?.path === "C:\\Users")
        return parentPathForUsers;

      if (payload?.path === "C:\\")
        return null;

      return null;
    }

    if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
      return null;

    if (command === "delete_paths")
      return null;

    if (command === "filesystem_transfer_conflicts")
      return [];

    throw new Error(`Unhandled invoke: ${command}`);
  });
}

const PANE_ID = "pane-left";
let testCount = 0;
let tabId = "";

// The pane under test, in a tab of its own: the operation queue and the undo histories are module
// state, which the tests share.
function renderNavigation(initialFilesystemState, options = {}) {
  return renderHook(() => useFilesystemNavigation(initialFilesystemState, { tabId, paneId: PANE_ID, ...options }));
}

function cancelRunningOperation() {
  cancelFilesystemOperation(tabId, getTabOperations(tabId).running.id);
}

describe("useFilesystemNavigation", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockClear();
    filesystemWatchHandler = undefined;
    testCount += 1;
    tabId = `tab-${testCount}`;
  });

  it("starts and stops a watcher as browsing state changes", async () => {
    mockFilesystemInvoke();

    const { result } = renderNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\",
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("filesystem_watch_start", {
        watchId: expect.any(String),
        path: "C:\\",
      });
    });

    act(() => {
      result.current.navigateToPath("");
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("filesystem_watch_stop", {
        watchId: expect.any(String),
      });
    });
  });

  it("refreshes entries when the active watcher emits a change", async () => {
    const listDirectoryCallCount = new Map();

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives")
        return [{ name: "C:", path: "C:\\" }];

      if (command === "list_directory_page") {
        const currentCount = (listDirectoryCallCount.get(payload?.path ?? "") ?? 0) + 1;
        listDirectoryCallCount.set(payload?.path ?? "", currentCount);

        const offset = payload?.offset ?? 0;
        const limit = payload?.limit ?? 120;
        if (payload?.path === "C:\\") {
          const entries = currentCount === 1
            ? [{ name: "Users", path: "C:\\Users", is_dir: true }]
            : [
            { name: "Users", path: "C:\\Users", is_dir: true },
            { name: "new.txt", path: "C:\\new.txt", is_dir: false },
          ];
          const pageEntries = entries.slice(offset, offset + limit);
          return {
            entries: pageEntries,
            hasMore: offset + pageEntries.length < entries.length,
            totalCount: entries.length,
          };
        }

        return { entries: [], hasMore: false, totalCount: 0 };
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
        return null;

      if (command === "filesystem_transfer_conflicts")
        return [];

      throw new Error(`Unhandled invoke: ${command}`);
    });

    const { result } = renderNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\",
    });

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users"]);
      expect(filesystemWatchHandler).toBeTypeOf("function");
    });

    const watchStartCall = invoke.mock.calls.find(([command]) => command === "filesystem_watch_start");
    const watchId = watchStartCall?.[1]?.watchId;

    vi.useFakeTimers();
    try {
      await filesystemWatchHandler?.({
        payload: {
          watchId,
          changedPath: "C:\\new.txt",
        },
      });
      await advanceTimersBy(150);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual([
        "C:\\Users",
        "C:\\new.txt",
      ]);
    });
  });

  it("clears browsing state when going up from drive root", async () => {
    mockFilesystemInvoke();

    const { result } = renderNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\",
      selectedPaths: ["C:\\Users"],
    });

    await waitFor(() => {
      expect(result.current.isLoadingEntries).toBe(false);
      expect(result.current.entries.length).toBe(1);
    });

    expect(result.current.currentDrive).toBe("C:\\");
    expect(result.current.currentPath).toBe("C:\\");
    expect(result.current.selectedPaths).toEqual(["C:\\Users"]);

    await act(async () => {
      await result.current.goUp();
    });

    await waitFor(() => {
      expect(result.current.currentDrive).toBe("");
      expect(result.current.currentPath).toBe("");
      expect(result.current.entries).toEqual([]);
    });

    expect(result.current.selectedPaths).toEqual([]);
    expect(invoke).not.toHaveBeenCalledWith("parent_path", expect.anything());
  });

  it("clears browsing state when parent path escapes current drive", async () => {
    mockFilesystemInvoke({ parentPathForUsers: "D:\\" });

    const { result } = renderNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\Users",
      selectedPaths: ["C:\\Users\\todo.txt"],
    });

    await waitFor(() => {
      expect(result.current.isLoadingEntries).toBe(false);
      expect(result.current.entries.length).toBe(1);
    });

    expect(result.current.selectedPaths).toEqual(["C:\\Users\\todo.txt"]);

    await act(async () => {
      await result.current.goUp();
    });

    await waitFor(() => {
      expect(result.current.currentDrive).toBe("");
      expect(result.current.currentPath).toBe("");
      expect(result.current.entries).toEqual([]);
    });

    expect(invoke).toHaveBeenCalledWith("parent_path", { path: "C:\\Users" });
    expect(result.current.selectedPaths).toEqual([]);
  });

  it("deletes selected entries and clears selection", async () => {
    const directoryState = {
      "C:\\": [
        { name: "Users", path: "C:\\Users", is_dir: true },
        { name: "todo.txt", path: "C:\\todo.txt", is_dir: false },
      ],
    };

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives")
        return [{ name: "C:", path: "C:\\" }];

      if (command === "list_directory_page") {
        const entries = (directoryState[payload?.path] ?? []).map((entry) => ({ ...entry }));
        const offset = payload?.offset ?? 0;
        const limit = payload?.limit ?? entries.length;
        const pageEntries = entries.slice(offset, offset + limit);
        return {
          entries: pageEntries,
          hasMore: offset + pageEntries.length < entries.length,
          totalCount: entries.length,
        };
      }

      if (command === "list_directory")
        return (directoryState[payload?.path] ?? []).map((entry) => ({ ...entry }));

      if (command === "delete_paths") {
        const paths = payload?.paths ?? [];
        paths.forEach((deletePath) => {
          directoryState["C:\\"] = (directoryState["C:\\"] ?? []).filter(
            entry => entry.path !== deletePath,
          );
        });
        return null;
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
        return null;

      if (command === "filesystem_transfer_conflicts")
        return [];

      throw new Error(`Unhandled invoke: ${command}`);
    });

    const { result } = renderNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\",
    });

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual([
        "C:\\Users",
        "C:\\todo.txt",
      ]);
    });

    act(() => {
      result.current.selectEntry("C:\\todo.txt");
    });

    expect(result.current.selectedPaths).toEqual(["C:\\todo.txt"]);

    let outcome;
    await act(async () => {
      outcome = await result.current.deleteEntries(["C:\\todo.txt"]);
    });

    expect(outcome).toBe("done");
    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users"]);
    });
    expect(result.current.selectedPaths).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("delete_paths", {
      paths: ["C:\\todo.txt"],
    });
  });

  it("ignores stale move refresh results after navigating to a different folder", async () => {
    const staleRefresh = createDeferred();
    const listDirectoryCallCount = new Map();

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives")
        return [{ name: "C:", path: "C:\\" }];

      if (command === "list_directory_page") {
        const path = payload?.path ?? "";
        const nextCount = (listDirectoryCallCount.get(path) ?? 0) + 1;
        listDirectoryCallCount.set(path, nextCount);
        const offset = payload?.offset ?? 0;
        const limit = payload?.limit ?? 120;

        if (path === "C:\\Users") {
          const entries = nextCount === 1
            ? [{ name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false }]
            : await staleRefresh.promise;
          const pageEntries = entries.slice(offset, offset + limit);
          return {
            entries: pageEntries,
            hasMore: offset + pageEntries.length < entries.length,
            totalCount: entries.length,
          };
        }

        if (path === "C:\\Projects") {
          const entries = [{ name: "readme.md", path: "C:\\Projects\\readme.md", is_dir: false }];
          const pageEntries = entries.slice(offset, offset + limit);
          return {
            entries: pageEntries,
            hasMore: false,
            totalCount: entries.length,
          };
        }

        return { entries: [], hasMore: false, totalCount: 0 };
      }

      if (command === "move_path")
        return { destination: "C:\\Archive\\todo.txt", merge: null };

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
        return null;

      if (command === "filesystem_transfer_conflicts")
        return [];

      throw new Error(`Unhandled invoke: ${command}`);
    });

    const { result } = renderNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\Users",
    });

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual([
        "C:\\Users\\todo.txt",
      ]);
    });

    // The move is done; the refresh of the folder it was done in is still on its way.
    await act(async () => {
      await result.current.moveEntries(
        ["C:\\Users\\todo.txt"],
        "C:\\Archive",
      );
    });

    act(() => {
      result.current.navigateToPath("C:\\Projects");
    });

    await waitFor(() => {
      expect(result.current.currentPath).toBe("C:\\Projects");
      expect(result.current.entries.map((entry) => entry.path)).toEqual([
        "C:\\Projects\\readme.md",
      ]);
    });

    await act(async () => {
      staleRefresh.resolve([
        { name: "stale.txt", path: "C:\\Users\\stale.txt", is_dir: false },
      ]);
    });

    expect(listDirectoryCallCount.get("C:\\Users")).toBe(2);
    expect(result.current.currentPath).toBe("C:\\Projects");
    expect(result.current.entries.map((entry) => entry.path)).toEqual([
      "C:\\Projects\\readme.md",
    ]);
  });

  it("supports undo and redo for move operations", async () => {
    const directoryState = {
      "C:\\Users": [{ name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false }],
      "C:\\Archive": [],
    };

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives")
        return [{ name: "C:", path: "C:\\" }];

      if (command === "list_directory_page") {
        const path = payload?.path ?? "";
        const entries = (directoryState[path] ?? []).map((entry) => ({ ...entry }));
        const offset = payload?.offset ?? 0;
        const limit = payload?.limit ?? entries.length;
        const pageEntries = entries.slice(offset, offset + limit);
        return {
          entries: pageEntries,
          hasMore: offset + pageEntries.length < entries.length,
          totalCount: entries.length,
        };
      }

      if (command === "move_path") {
        const sourcePath = payload?.source ?? "";
        const destinationDir = payload?.destinationDir ?? "";
        const sourceDir = sourcePath.slice(0, Math.max(sourcePath.lastIndexOf("\\"), sourcePath.lastIndexOf("/")));
        const sourceName = sourcePath.slice(Math.max(sourcePath.lastIndexOf("\\"), sourcePath.lastIndexOf("/")) + 1);
        const destinationPath = `${destinationDir}\\${sourceName}`;

        const sourceEntries = directoryState[sourceDir] ?? [];
        const sourceEntry = sourceEntries.find(entry => entry.path === sourcePath);
        if (!sourceEntry) throw new Error("Source entry not found.");

        directoryState[sourceDir] = sourceEntries.filter(entry => entry.path !== sourcePath);
        directoryState[destinationDir] = [
          ...(directoryState[destinationDir] ?? []),
          {
            ...sourceEntry,
            path: destinationPath,
          },
        ];

        return { destination: destinationPath, merge: null };
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
        return null;

      if (command === "filesystem_transfer_conflicts")
        return [];

      throw new Error(`Unhandled invoke: ${command}`);
    });

    const { result } = renderNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\Users",
    });

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users\\todo.txt"]);
    });

    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\todo.txt"], "C:\\Archive");
    });

    await waitFor(() => {
      expect(result.current.entries).toEqual([]);
    });

    await act(async () => {
      await result.current.undoEntries();
    });

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users\\todo.txt"]);
    });

    await act(async () => {
      await result.current.redoEntries();
    });

    await waitFor(() => {
      expect(result.current.entries).toEqual([]);
    });
    expect(invoke).not.toHaveBeenCalledWith("recreate_folders", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("remove_empty_folders", expect.anything());
  });

  // Photos merges into C:\Archive\Photos; other moves (the undo and redo ones) move plainly.
  function mockFolderMerge(mergePhotos) {
    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives") return [{ name: "C:", path: "C:\\" }];
      if (command === "list_directory_page") {
        const entries = payload?.path === "C:\\Users"
          ? [
            { name: "Photos", path: "C:\\Users\\Photos", is_dir: true },
            { name: "notes.txt", path: "C:\\Users\\notes.txt", is_dir: false },
          ]
          : [];
        return { entries, hasMore: false, totalCount: entries.length };
      }
      if (command === "filesystem_transfer_conflicts") return [{ path: "C:\\Users\\Photos", mergesFolders: true }];
      if (command === "move_path") {
        if (payload.source === "C:\\Users\\Photos") return mergePhotos();
        return { destination: `${payload.destinationDir}\\${payload.source.split("\\").at(-1)}`, merge: null };
      }
      if (["recreate_folders", "remove_empty_folders", "filesystem_transfer_cancel"].includes(command)) return null;
      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") return null;
      throw new Error(`Unhandled invoke: ${command}`);
    });
  }

  function getMoveHistoryCalls() {
    return invoke.mock.calls
      .filter(([command]) => ["move_path", "recreate_folders", "remove_empty_folders"].includes(command))
      .map(([command, payload]) => (command === "move_path"
        ? `move ${payload.source} -> ${payload.destinationDir} (${payload.conflictPolicy})`
        : `${command} ${payload.paths.join(", ")}`));
  }

  it("undoes and redoes a folder merge item by item, recreating and removing the emptied source folders", async () => {
    mockFolderMerge(() => ({
      destination: "C:\\Archive\\Photos",
      merge: {
        movedItems: [
          { sourcePath: "C:\\Users\\Photos\\Trips\\paris.jpg", destinationPath: "C:\\Archive\\Photos\\Trips\\paris.jpg" },
          { sourcePath: "C:\\Users\\Photos\\new.jpg", destinationPath: "C:\\Archive\\Photos\\new.jpg" },
        ],
        removedFolders: ["C:\\Users\\Photos\\Trips", "C:\\Users\\Photos"],
      },
    }));
    const { result } = renderNavigation(
      { currentDrive: "C:\\", currentPath: "C:\\Users" },
      { openChoice: async () => "replace" },
    );
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });

    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\Photos"], "C:\\Archive");
    });
    let undone;
    let redone;
    await act(async () => {
      undone = await result.current.undoEntries();
    });
    await act(async () => {
      redone = await result.current.redoEntries();
    });

    expect(undone).toBe("done");
    expect(redone).toBe("done");
    expect(getMoveHistoryCalls()).toEqual([
      "move C:\\Users\\Photos -> C:\\Archive (replace)",
      "recreate_folders C:\\Users\\Photos\\Trips, C:\\Users\\Photos",
      "move C:\\Archive\\Photos\\new.jpg -> C:\\Users\\Photos (fail)",
      "move C:\\Archive\\Photos\\Trips\\paris.jpg -> C:\\Users\\Photos\\Trips (fail)",
      "move C:\\Users\\Photos\\Trips\\paris.jpg -> C:\\Archive\\Photos\\Trips (fail)",
      "move C:\\Users\\Photos\\new.jpg -> C:\\Archive\\Photos (fail)",
      "remove_empty_folders C:\\Users\\Photos\\Trips, C:\\Users\\Photos",
    ]);
  });

  it("keeps an undo entry for what a cancelled folder merge moved", async () => {
    let result;
    mockFolderMerge(() => {
      cancelRunningOperation();
      return {
        destination: "C:\\Archive\\Photos",
        merge: {
          movedItems: [{ sourcePath: "C:\\Users\\Photos\\new.jpg", destinationPath: "C:\\Archive\\Photos\\new.jpg" }],
          removedFolders: [],
        },
      };
    });
    ({ result } = renderNavigation(
      { currentDrive: "C:\\", currentPath: "C:\\Users" },
      { openChoice: async () => "replace" },
    ));
    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });

    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\Photos", "C:\\Users\\notes.txt"], "C:\\Archive");
    });
    await act(async () => {
      await result.current.undoEntries();
    });

    expect(getMoveHistoryCalls()).toEqual([
      "move C:\\Users\\Photos -> C:\\Archive (replace)",
      "move C:\\Archive\\Photos\\new.jpg -> C:\\Users\\Photos (fail)",
    ]);
  });

  // Photos holds a.jpg, b.jpg and c.jpg, which all merge into C:\Archive\Photos.
  function mergeOfThree() {
    return {
      destination: "C:\\Archive\\Photos",
      merge: {
        movedItems: ["a.jpg", "b.jpg", "c.jpg"].map((name) => ({
          sourcePath: `C:\\Users\\Photos\\${name}`,
          destinationPath: `C:\\Archive\\Photos\\${name}`,
        })),
        removedFolders: ["C:\\Users\\Photos"],
      },
    };
  }

  async function renderMergeNavigation(pushNotification) {
    const hook = renderNavigation(
      { currentDrive: "C:\\", currentPath: "C:\\Users" },
      { openChoice: async () => "replace", pushNotification },
    );
    await waitFor(() => {
      expect(hook.result.current.entries).toHaveLength(2);
    });
    return hook.result;
  }

  // Runs `intercept` before the current mock answers a call; throwing there fails the call.
  function interceptInvoke(intercept) {
    const answer = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => {
      await intercept(command, payload);
      return answer(command, payload);
    });
  }

  const lockedError = (path) => (
    `'${path}': The process cannot access the file because it is being used by another process. (os error 32)`
  );

  it("keeps an undo entry for a merge when a later item of the batch fails", async () => {
    mockFolderMerge(mergeOfThree);
    interceptInvoke((command, payload) => {
      if (command === "move_path" && payload.source === "C:\\Users\\notes.txt") throw lockedError(payload.source);
    });
    const pushNotification = vi.fn();
    const result = await renderMergeNavigation(pushNotification);

    let moved;
    await act(async () => {
      moved = await result.current.moveEntries(["C:\\Users\\Photos", "C:\\Users\\notes.txt"], "C:\\Archive");
    });
    let undone;
    await act(async () => {
      undone = await result.current.undoEntries();
    });

    expect(moved).toBe("failed");
    expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Move failed",
      message: lockedError("C:\\Users\\notes.txt"),
    }));
    expect(undone).toBe("done");
    expect(getMoveHistoryCalls()).toEqual([
      "move C:\\Users\\Photos -> C:\\Archive (replace)",
      "move C:\\Users\\notes.txt -> C:\\Archive (replace)",
      "recreate_folders C:\\Users\\Photos",
      "move C:\\Archive\\Photos\\c.jpg -> C:\\Users\\Photos (fail)",
      "move C:\\Archive\\Photos\\b.jpg -> C:\\Users\\Photos (fail)",
      "move C:\\Archive\\Photos\\a.jpg -> C:\\Users\\Photos (fail)",
    ]);
  });

  it("keeps an undo entry for what a merge moved before it failed, and moves nothing after it", async () => {
    mockFolderMerge(() => ({
      destination: "C:\\Archive\\Photos",
      merge: {
        movedItems: [{ sourcePath: "C:\\Users\\Photos\\a.jpg", destinationPath: "C:\\Archive\\Photos\\a.jpg" }],
        removedFolders: [],
      },
      error: lockedError("C:\\Users\\Photos\\b.jpg"),
    }));
    const pushNotification = vi.fn();
    const result = await renderMergeNavigation(pushNotification);

    let moved;
    await act(async () => {
      moved = await result.current.moveEntries(["C:\\Users\\Photos", "C:\\Users\\notes.txt"], "C:\\Archive");
    });
    await act(async () => {
      await result.current.undoEntries();
    });

    expect(moved).toBe("failed");
    expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Move failed",
      message: lockedError("C:\\Users\\Photos\\b.jpg"),
    }));
    expect(getMoveHistoryCalls()).toEqual([
      "move C:\\Users\\Photos -> C:\\Archive (replace)",
      "move C:\\Archive\\Photos\\a.jpg -> C:\\Users\\Photos (fail)",
    ]);
  });

  it("splits the entry when an undo is cancelled part way, so redo and undo go on from there", async () => {
    let cancelOnce = true;
    mockFolderMerge(mergeOfThree);
    interceptInvoke((command, payload) => {
      // Cancel is clicked while the first undo moves c.jpg back.
      if (cancelOnce && command === "move_path" && payload.source === "C:\\Archive\\Photos\\c.jpg") {
        cancelOnce = false;
        cancelRunningOperation();
      }
    });
    const result = await renderMergeNavigation();

    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\Photos"], "C:\\Archive");
    });
    const outcomes = [];
    for (const step of ["undoEntries", "redoEntries", "undoEntries", "undoEntries", "undoEntries"]) {
      await act(async () => {
        outcomes.push(await result.current[step]());
      });
    }

    expect(outcomes).toEqual(["cancelled", "done", "done", "done", undefined]);
    expect(getMoveHistoryCalls()).toEqual([
      "move C:\\Users\\Photos -> C:\\Archive (replace)",
      "recreate_folders C:\\Users\\Photos",
      "move C:\\Archive\\Photos\\c.jpg -> C:\\Users\\Photos (fail)",
      // The redo and the undo after it take only c.jpg, which the cancelled undo moved back.
      "move C:\\Users\\Photos\\c.jpg -> C:\\Archive\\Photos (fail)",
      "remove_empty_folders C:\\Users\\Photos",
      "recreate_folders C:\\Users\\Photos",
      "move C:\\Archive\\Photos\\c.jpg -> C:\\Users\\Photos (fail)",
      // The next undo moves back the rest.
      "recreate_folders C:\\Users\\Photos",
      "move C:\\Archive\\Photos\\b.jpg -> C:\\Users\\Photos (fail)",
      "move C:\\Archive\\Photos\\a.jpg -> C:\\Users\\Photos (fail)",
    ]);
  });

  it("splits the entry when a redo fails part way, so a retry goes on from there", async () => {
    mockFolderMerge(mergeOfThree);
    const pushNotification = vi.fn();
    const result = await renderMergeNavigation(pushNotification);
    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\Photos"], "C:\\Archive");
    });
    await act(async () => {
      await result.current.undoEntries();
    });
    let lockedOnce = true;
    interceptInvoke((command, payload) => {
      if (lockedOnce && command === "move_path" && payload.source === "C:\\Users\\Photos\\b.jpg") {
        lockedOnce = false;
        throw lockedError(payload.source);
      }
    });
    invoke.mockClear();

    const outcomes = [];
    for (const step of ["redoEntries", "redoEntries", "undoEntries", "undoEntries"]) {
      await act(async () => {
        outcomes.push(await result.current[step]());
      });
    }

    expect(outcomes).toEqual(["failed", "done", "done", "done"]);
    expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Redo failed",
      message: lockedError("C:\\Users\\Photos\\b.jpg"),
    }));
    expect(getMoveHistoryCalls()).toEqual([
      "move C:\\Users\\Photos\\a.jpg -> C:\\Archive\\Photos (fail)",
      "move C:\\Users\\Photos\\b.jpg -> C:\\Archive\\Photos (fail)",
      // The retry starts at b.jpg, where the failed redo stopped.
      "move C:\\Users\\Photos\\b.jpg -> C:\\Archive\\Photos (fail)",
      "move C:\\Users\\Photos\\c.jpg -> C:\\Archive\\Photos (fail)",
      "remove_empty_folders C:\\Users\\Photos",
      // Each undo takes back what one redo moved.
      "recreate_folders C:\\Users\\Photos",
      "move C:\\Archive\\Photos\\c.jpg -> C:\\Users\\Photos (fail)",
      "move C:\\Archive\\Photos\\b.jpg -> C:\\Users\\Photos (fail)",
      "recreate_folders C:\\Users\\Photos",
      "move C:\\Archive\\Photos\\a.jpg -> C:\\Users\\Photos (fail)",
    ]);
  });

  it("keeps the whole entry to undo when an undo fails at its first item", async () => {
    let lockedOnce = true;
    mockFolderMerge(mergeOfThree);
    interceptInvoke((command, payload) => {
      if (lockedOnce && command === "move_path" && payload.source === "C:\\Archive\\Photos\\c.jpg") {
        lockedOnce = false;
        throw lockedError(payload.source);
      }
    });
    const result = await renderMergeNavigation();
    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\Photos"], "C:\\Archive");
    });

    const outcomes = [];
    for (const step of ["undoEntries", "redoEntries", "undoEntries"]) {
      await act(async () => {
        outcomes.push(await result.current[step]());
      });
    }

    // Nothing was undone, so there is nothing to redo, and the retry undoes all of it.
    expect(outcomes).toEqual(["failed", undefined, "done"]);
    expect(getMoveHistoryCalls()).toEqual([
      "move C:\\Users\\Photos -> C:\\Archive (replace)",
      "recreate_folders C:\\Users\\Photos",
      "move C:\\Archive\\Photos\\c.jpg -> C:\\Users\\Photos (fail)",
      "recreate_folders C:\\Users\\Photos",
      "move C:\\Archive\\Photos\\c.jpg -> C:\\Users\\Photos (fail)",
      "move C:\\Archive\\Photos\\b.jpg -> C:\\Users\\Photos (fail)",
      "move C:\\Archive\\Photos\\a.jpg -> C:\\Users\\Photos (fail)",
    ]);
  });

  it("records a merge that moved 200,000 items", async () => {
    const movedItems = Array.from({ length: 200000 }, (_, index) => ({
      sourcePath: `C:\\Users\\Photos\\${index}.jpg`,
      destinationPath: `C:\\Archive\\Photos\\${index}.jpg`,
    }));
    mockFolderMerge(() => ({
      destination: "C:\\Archive\\Photos",
      merge: { movedItems, removedFolders: ["C:\\Users\\Photos"] },
    }));
    const pushNotification = vi.fn();
    const result = await renderMergeNavigation(pushNotification);

    let moved;
    await act(async () => {
      moved = await result.current.moveEntries(["C:\\Users\\Photos"], "C:\\Archive");
    });

    expect(moved).toBe("done");
    expect(getPaneHistory(getPaneHistoryKey(tabId, PANE_ID)).undo[0].items).toHaveLength(200000);
    expect(pushNotification).not.toHaveBeenCalled();
  });

  it("undoes and redoes a merge that only removed folders, refreshing the folder each time", async () => {
    mockFolderMerge(() => ({
      destination: "C:\\Archive\\Photos",
      merge: { movedItems: [], removedFolders: ["C:\\Users\\Photos\\2019", "C:\\Users\\Photos"] },
    }));
    const countRefreshes = () => invoke.mock.calls
      .filter(([command, payload]) => command === "list_directory_page" && payload.refresh)
      .length;
    const result = await renderMergeNavigation();

    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\Photos"], "C:\\Archive");
    });
    const refreshesBefore = countRefreshes();
    let undone;
    await act(async () => {
      undone = await result.current.undoEntries();
    });
    const refreshesAfterUndo = countRefreshes();
    let redone;
    await act(async () => {
      redone = await result.current.redoEntries();
    });

    expect(undone).toBe("done");
    expect(redone).toBe("done");
    expect(getMoveHistoryCalls()).toEqual([
      "move C:\\Users\\Photos -> C:\\Archive (replace)",
      "recreate_folders C:\\Users\\Photos\\2019, C:\\Users\\Photos",
      "remove_empty_folders C:\\Users\\Photos\\2019, C:\\Users\\Photos",
    ]);
    expect(refreshesAfterUndo).toBe(refreshesBefore + 1);
    expect(countRefreshes()).toBe(refreshesAfterUndo + 1);
  });

  it("keeps the undo running while it recreates folders and the redo while it removes them", async () => {
    mockFolderMerge(mergeOfThree);
    const result = await renderMergeNavigation();
    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\Photos"], "C:\\Archive");
    });
    const runningDuringFolderChanges = [];
    interceptInvoke((command) => {
      if (command !== "recreate_folders" && command !== "remove_empty_folders") return;
      runningDuringFolderChanges.push(`${command}: ${getTabOperations(tabId).running?.label}`);
    });

    await act(async () => {
      await result.current.undoEntries();
    });
    await act(async () => {
      await result.current.redoEntries();
    });

    // So whatever is started meanwhile waits behind them.
    expect(runningDuringFolderChanges).toEqual(["recreate_folders: Undoing", "remove_empty_folders: Redoing"]);
    expect(hasFilesystemOperations(tabId)).toBe(false);
  });

  it("shows a notification with reason when move fails", async () => {
    const pushNotification = vi.fn();

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives") return [{ name: "C:", path: "C:\\" }];

      if (command === "list_directory_page") {
        if (payload?.path === "C:\\Users") {
          return {
            entries: [{ name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false }],
            hasMore: false,
            totalCount: 1,
          };
        }
        return { entries: [], hasMore: false, totalCount: 0 };
      }

      if (command === "move_path") {
        throw new Error("An item named 'todo.txt' already exists in the destination folder.");
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") return null;

      if (command === "filesystem_transfer_conflicts")
        return [];

      throw new Error(`Unhandled invoke: ${command}`);
    });

    const { result } = renderNavigation(
      { currentDrive: "C:\\", currentPath: "C:\\Users" },
      { pushNotification },
    );

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users\\todo.txt"]);
    });

    await act(async () => {
      expect(await result.current.moveEntries(["C:\\Users\\todo.txt"], "C:\\Archive")).toBe("failed");
    });

    expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Move failed",
      tone: "error",
      takeFocus: false,
      message: expect.stringContaining("already exists"),
    }));
    expect(result.current.error).toBe("");
  });

  it("supports undo and redo for rename operations", async () => {
    const directoryState = {
      "C:\\Users": [{ name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false }],
    };

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives")
        return [{ name: "C:", path: "C:\\" }];

      if (command === "list_directory_page") {
        const path = payload?.path ?? "";
        const entries = (directoryState[path] ?? []).map((entry) => ({ ...entry }));
        const offset = payload?.offset ?? 0;
        const limit = payload?.limit ?? entries.length;
        const pageEntries = entries.slice(offset, offset + limit);
        return {
          entries: pageEntries,
          hasMore: offset + pageEntries.length < entries.length,
          totalCount: entries.length,
        };
      }

      if (command === "rename_path") {
        const sourcePath = payload?.path ?? "";
        const newName = payload?.newName ?? "";
        const parentPath = sourcePath.slice(0, sourcePath.lastIndexOf("\\"));
        const sourceEntries = directoryState[parentPath] ?? [];
        const sourceEntry = sourceEntries.find(entry => entry.path === sourcePath);
        if (!sourceEntry) throw new Error("Source entry not found.");

        const conflictEntry = sourceEntries.find((entry) => (
          entry.path !== sourcePath && entry.name === newName
        ));
        if (conflictEntry && payload?.allowAdjustment === false) throw new Error("Target already exists.");
        if (conflictEntry) throw new Error("Target already exists.");

        const destinationPath = `${parentPath}\\${newName}`;
        directoryState[parentPath] = sourceEntries.map((entry) => (
          entry.path === sourcePath
            ? { ...entry, name: newName, path: destinationPath }
            : entry
        ));
        return {
          path: destinationPath,
          name: newName,
          requestedName: newName,
          adjusted: false,
        };
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
        return null;

      if (command === "filesystem_transfer_conflicts")
        return [];

      throw new Error(`Unhandled invoke: ${command}`);
    });

    const { result } = renderNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\Users",
    });

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users\\todo.txt"]);
    });

    await act(async () => {
      await result.current.renameEntry("C:\\Users\\todo.txt", "renamed.txt");
    });

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users\\renamed.txt"]);
    });

    await act(async () => {
      await result.current.undoEntries();
    });

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users\\todo.txt"]);
    });
    expect(invoke).toHaveBeenCalledWith("rename_path", {
      path: "C:\\Users\\renamed.txt",
      newName: "todo.txt",
      allowAdjustment: false,
    });

    await act(async () => {
      await result.current.redoEntries();
    });

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users\\renamed.txt"]);
    });
    expect(invoke).toHaveBeenCalledWith("rename_path", {
      path: "C:\\Users\\todo.txt",
      newName: "renamed.txt",
      allowAdjustment: false,
    });
  });

  it("ignores stale import refresh results after navigating to a different folder", async () => {
    const staleRefresh = createDeferred();
    const listDirectoryCallCount = new Map();

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives")
        return [{ name: "C:", path: "C:\\" }];

      if (command === "list_directory_page") {
        const path = payload?.path ?? "";
        const nextCount = (listDirectoryCallCount.get(path) ?? 0) + 1;
        listDirectoryCallCount.set(path, nextCount);
        const offset = payload?.offset ?? 0;
        const limit = payload?.limit ?? 120;

        if (path === "C:\\Users") {
          const entries = nextCount === 1
            ? [{ name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false }]
            : await staleRefresh.promise;
          const pageEntries = entries.slice(offset, offset + limit);
          return {
            entries: pageEntries,
            hasMore: offset + pageEntries.length < entries.length,
            totalCount: entries.length,
          };
        }

        if (path === "C:\\Projects") {
          const entries = [{ name: "readme.md", path: "C:\\Projects\\readme.md", is_dir: false }];
          const pageEntries = entries.slice(offset, offset + limit);
          return {
            entries: pageEntries,
            hasMore: false,
            totalCount: entries.length,
          };
        }

        return { entries: [], hasMore: false, totalCount: 0 };
      }

      if (command === "import_paths")
        return null;

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
        return null;

      if (command === "filesystem_transfer_conflicts")
        return [];

      throw new Error(`Unhandled invoke: ${command}`);
    });

    const { result } = renderNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\Users",
    });

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual([
        "C:\\Users\\todo.txt",
      ]);
    });

    // The import is done; the refresh of the folder it went into is still on its way.
    await act(async () => {
      await result.current.importExternalPaths(["D:\\Downloads\\clip.mp4"], "C:\\Users");
    });

    act(() => {
      result.current.navigateToPath("C:\\Projects");
    });

    await waitFor(() => {
      expect(result.current.currentPath).toBe("C:\\Projects");
      expect(result.current.entries.map((entry) => entry.path)).toEqual([
        "C:\\Projects\\readme.md",
      ]);
    });

    await act(async () => {
      staleRefresh.resolve([
        { name: "clip.mp4", path: "C:\\Users\\clip.mp4", is_dir: false },
      ]);
    });

    expect(listDirectoryCallCount.get("C:\\Users")).toBe(2);
    expect(result.current.currentPath).toBe("C:\\Projects");
    expect(result.current.entries.map((entry) => entry.path)).toEqual([
      "C:\\Projects\\readme.md",
    ]);
  });

  it("shows a notification with reason when copy fails", async () => {
    const pushNotification = vi.fn();

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives") return [{ name: "C:", path: "C:\\" }];

      if (command === "list_directory_page") {
        if (payload?.path === "C:\\Users") {
          return {
            entries: [{ name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false }],
            hasMore: false,
            totalCount: 1,
          };
        }
        return { entries: [], hasMore: false, totalCount: 0 };
      }

      if (command === "import_paths") {
        throw new Error("An item named 'todo.txt' already exists in the destination folder.");
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") return null;

      if (command === "filesystem_transfer_conflicts")
        return [];

      throw new Error(`Unhandled invoke: ${command}`);
    });

    const { result } = renderNavigation(
      { currentDrive: "C:\\", currentPath: "C:\\Users" },
      { pushNotification },
    );

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users\\todo.txt"]);
    });

    await act(async () => {
      expect(await result.current.copyEntries(["C:\\Users\\todo.txt"], "C:\\Archive")).toBe("failed");
    });

    expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Copy failed",
      tone: "error",
      takeFocus: false,
      message: expect.stringContaining("already exists"),
    }));
    expect(result.current.error).toBe("");
  });

  it("shows a notification with reason when external import fails", async () => {
    const pushNotification = vi.fn();

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives") return [{ name: "C:", path: "C:\\" }];

      if (command === "list_directory_page") {
        if (payload?.path === "C:\\Users") {
          return {
            entries: [{ name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false }],
            hasMore: false,
            totalCount: 1,
          };
        }
        return { entries: [], hasMore: false, totalCount: 0 };
      }

      if (command === "import_paths") {
        throw new Error("Access is denied. (os error 5)");
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") return null;

      if (command === "filesystem_transfer_conflicts")
        return [];

      throw new Error(`Unhandled invoke: ${command}`);
    });

    const { result } = renderNavigation(
      { currentDrive: "C:\\", currentPath: "C:\\Users" },
      { pushNotification },
    );

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users\\todo.txt"]);
    });

    await act(async () => {
      expect(await result.current.importExternalPaths(["D:\\Downloads\\clip.mp4"], "C:\\Users")).toBe("failed");
    });

    expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Import failed",
      tone: "error",
      takeFocus: false,
      message: expect.stringContaining("Access is denied"),
    }));
    expect(result.current.error).toBe("");
  });

  it("tracks back-forward history across folder navigation and clears forward history on new navigation", async () => {
    const directoryState = {
      "C:\\": [{ name: "Users", path: "C:\\Users", is_dir: true }],
      "C:\\Users": [{ name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false }],
      "C:\\Projects": [{ name: "readme.md", path: "C:\\Projects\\readme.md", is_dir: false }],
      "C:\\Temp": [],
    };

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives")
        return [{ name: "C:", path: "C:\\" }];

      if (command === "list_directory_page") {
        const path = payload?.path ?? "";
        const entries = (directoryState[path] ?? []).map((entry) => ({ ...entry }));
        const offset = payload?.offset ?? 0;
        const limit = payload?.limit ?? entries.length;
        const pageEntries = entries.slice(offset, offset + limit);
        return {
          entries: pageEntries,
          hasMore: offset + pageEntries.length < entries.length,
          totalCount: entries.length,
        };
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
        return null;

      if (command === "filesystem_transfer_conflicts")
        return [];

      throw new Error(`Unhandled invoke: ${command}`);
    });

    const { result } = renderNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\",
    });

    await waitFor(() => {
      expect(result.current.currentPath).toBe("C:\\");
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users"]);
    });
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(false);

    act(() => {
      result.current.navigateToPath("C:\\Users");
    });
    await waitFor(() => {
      expect(result.current.currentPath).toBe("C:\\Users");
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users\\todo.txt"]);
    });
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);

    act(() => {
      result.current.navigateToPath("C:\\Projects");
    });
    await waitFor(() => {
      expect(result.current.currentPath).toBe("C:\\Projects");
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Projects\\readme.md"]);
    });

    let didGoBack = false;
    act(() => {
      didGoBack = result.current.goBack();
    });
    expect(didGoBack).toBe(true);
    await waitFor(() => {
      expect(result.current.currentPath).toBe("C:\\Users");
    });
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(true);

    act(() => {
      result.current.navigateToPath("C:\\Temp");
    });
    await waitFor(() => {
      expect(result.current.currentPath).toBe("C:\\Temp");
      expect(result.current.entries).toEqual([]);
    });

    let didGoForward = true;
    act(() => {
      didGoForward = result.current.goForward();
    });
    expect(didGoForward).toBe(false);
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);
  });

  it("adds go-up transitions to history and supports back-forward from drives view", async () => {
    mockFilesystemInvoke();

    const { result } = renderNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\",
    });

    await waitFor(() => {
      expect(result.current.currentPath).toBe("C:\\");
      expect(result.current.entries.length).toBe(1);
    });

    await act(async () => {
      await result.current.goUp();
    });
    await waitFor(() => {
      expect(result.current.currentPath).toBe("");
      expect(result.current.currentDrive).toBe("");
    });
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);

    let didGoBack = false;
    act(() => {
      didGoBack = result.current.goBack();
    });
    expect(didGoBack).toBe(true);
    await waitFor(() => {
      expect(result.current.currentPath).toBe("C:\\");
      expect(result.current.currentDrive).toBe("C:\\");
    });
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(true);

    let didGoForward = false;
    act(() => {
      didGoForward = result.current.goForward();
    });
    expect(didGoForward).toBe(true);
    await waitFor(() => {
      expect(result.current.currentPath).toBe("");
      expect(result.current.currentDrive).toBe("");
    });
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);
  });

  it("loads additional directory pages on demand", async () => {
    const pagedEntries = [
      { name: "a.txt", path: "C:\\a.txt", is_dir: false },
      { name: "b.txt", path: "C:\\b.txt", is_dir: false },
      { name: "c.txt", path: "C:\\c.txt", is_dir: false },
    ];

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives")
        return [{ name: "C:", path: "C:\\" }];

      if (command === "list_directory_page") {
        const offset = payload?.offset ?? 0;
        const page = pagedEntries.slice(offset, offset + 2);
        return {
          entries: page,
          hasMore: offset + page.length < pagedEntries.length,
          totalCount: pagedEntries.length,
        };
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
        return null;

      if (command === "filesystem_transfer_conflicts")
        return [];

      throw new Error(`Unhandled invoke: ${command}`);
    });

    const { result } = renderNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\",
    });

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual([
        "C:\\a.txt",
        "C:\\b.txt",
      ]);
      expect(result.current.hasMoreEntries).toBe(true);
    });

    await act(async () => {
      await result.current.loadMoreEntries();
    });

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual([
        "C:\\a.txt",
        "C:\\b.txt",
        "C:\\c.txt",
      ]);
      expect(result.current.hasMoreEntries).toBe(false);
    });
  });

  // C:\Users holds a.txt and b.txt; every other folder is empty. A `conflicts` function answers
  // with the conflicts as the destination holds them at the time.
  function mockTransferFolder({
    conflicts = [],
    onImport = async () => ({}),
    onMove = async () => ({ destination: null, merge: null }),
    onRename = async ({ path, newName }) => ({ path: path.replace(/[^\\]+$/, newName), name: newName, adjusted: false }),
    onDelete = async () => null,
  } = {}) {
    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives") return [{ name: "C:", path: "C:\\" }];
      if (command === "list_directory_page") {
        const entries = payload?.path === "C:\\Users"
          ? [
            { name: "a.txt", path: "C:\\Users\\a.txt", is_dir: false },
            { name: "b.txt", path: "C:\\Users\\b.txt", is_dir: false },
          ]
          : [];
        return { entries, hasMore: false, totalCount: entries.length };
      }
      if (command === "filesystem_transfer_conflicts") return typeof conflicts === "function" ? conflicts(payload) : conflicts;
      if (command === "import_paths") return onImport(payload);
      if (command === "move_path") return onMove(payload);
      if (command === "rename_path") return onRename(payload);
      if (command === "delete_paths") return onDelete(payload);
      if (command === "filesystem_transfer_cancel") return null;
      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") return null;
      if (command === "filesystem_search_start" || command === "filesystem_search_cancel") return null;
      throw new Error(`Unhandled invoke: ${command}`);
    });
  }

  async function renderTransferNavigation(options) {
    const hook = renderNavigation(
      { currentDrive: "C:\\", currentPath: "C:\\Users" },
      options,
    );
    await waitFor(() => {
      expect(hook.result.current.entries).toHaveLength(2);
    });
    return hook;
  }

  function getMoveCalls() {
    return invoke.mock.calls
      .filter(([command]) => command === "move_path")
      .map(([, payload]) => `${payload.source} -> ${payload.destinationDir}`);
  }

  it("skips conflicting items when the user picks Skip", async () => {
    mockTransferFolder({ conflicts: [{ path: "C:\\Users\\a.txt", mergesFolders: false }] });
    const openChoice = vi.fn(async () => "skip");
    const { result } = await renderTransferNavigation({ openChoice });

    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\a.txt", "C:\\Users\\b.txt"], "C:\\Archive");
    });

    const movedSources = invoke.mock.calls
      .filter(([command]) => command === "move_path")
      .map(([, payload]) => payload.source);
    expect(movedSources).toEqual(["C:\\Users\\b.txt"]);
    expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
      conflictPolicy: "fail",
      jobId: expect.stringMatching(/^filesystem-transfer-/),
    }));
  });

  it("copies with the picked conflict policy and does nothing when the prompt is cancelled", async () => {
    mockTransferFolder({ conflicts: [{ path: "C:\\Users\\a.txt", mergesFolders: false }] });
    const openChoice = vi.fn()
      .mockResolvedValueOnce("keep-both")
      .mockResolvedValueOnce(null);
    const { result } = await renderTransferNavigation({ openChoice });

    await act(async () => {
      await result.current.copyEntries(["C:\\Users\\a.txt"], "C:\\Archive");
    });
    expect(invoke).toHaveBeenCalledWith("import_paths", expect.objectContaining({
      paths: ["C:\\Users\\a.txt"],
      destinationDir: "C:\\Archive",
      conflictPolicy: "keep-both",
    }));

    invoke.mockClear();
    let outcome;
    await act(async () => {
      outcome = await result.current.copyEntries(["C:\\Users\\a.txt"], "C:\\Archive");
    });
    expect(outcome).toBe("cancelled");
    expect(invoke).not.toHaveBeenCalledWith("import_paths", expect.anything());
  });

  it("undoes and redoes a Keep both move under the names the item had", async () => {
    const files = new Set(["C:\\Users\\a.txt", "C:\\Archive\\a.txt"]);
    mockTransferFolder({
      conflicts: [{ path: "C:\\Users\\a.txt", mergesFolders: false }],
      // Keep both picks "a (2).txt"; a missing source or any other taken name fails.
      onMove: async ({ source, destinationDir, targetName, conflictPolicy }) => {
        let destination = `${destinationDir}\\${targetName ?? source.split("\\").at(-1)}`;
        if (conflictPolicy === "keep-both" && files.has(destination)) destination = destination.replace(".txt", " (2).txt");
        if (!files.has(source) || files.has(destination)) throw `Cannot move '${source}' to '${destination}'.`;
        files.delete(source);
        files.add(destination);
        return { destination, merge: null };
      },
    });
    const { result } = await renderTransferNavigation({ openChoice: async () => "keep-both" });
    const sortedFiles = () => [...files].sort();

    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\a.txt"], "C:\\Archive");
    });
    const afterMove = sortedFiles();
    let undone;
    await act(async () => {
      undone = await result.current.undoEntries();
    });
    const afterUndo = sortedFiles();
    let redone;
    await act(async () => {
      redone = await result.current.redoEntries();
    });

    expect(afterMove).toEqual(["C:\\Archive\\a (2).txt", "C:\\Archive\\a.txt"]);
    expect(undone).toBe("done");
    expect(afterUndo).toEqual(["C:\\Archive\\a.txt", "C:\\Users\\a.txt"]);
    expect(redone).toBe("done");
    expect(sortedFiles()).toEqual(["C:\\Archive\\a (2).txt", "C:\\Archive\\a.txt"]);
  });

  it("reports copy progress to the tab's queue and treats a cancelled copy as no error", async () => {
    const pushNotification = vi.fn();
    let rejectImport;
    mockTransferFolder({
      onImport: () => new Promise((_resolve, reject) => {
        rejectImport = reject;
      }),
    });
    const { result } = await renderTransferNavigation({ pushNotification });

    let copyPromise;
    act(() => {
      copyPromise = result.current.copyEntries(["C:\\Users\\a.txt", "C:\\Users\\b.txt"], "C:\\Archive");
    });
    await waitFor(() => {
      expect(getTabOperations(tabId).running?.progress).toMatchObject({ kind: "copy", itemsTotal: 2 });
    });

    const { id: jobId } = getTabOperations(tabId).running;
    act(() => cancelRunningOperation());
    expect(invoke).toHaveBeenCalledWith("filesystem_transfer_cancel", { jobId });
    let outcome;
    await act(async () => {
      rejectImport(new Error("The transfer was cancelled."));
      outcome = await copyPromise;
    });

    expect(outcome).toBe("cancelled");
    expect(hasFilesystemOperations(tabId)).toBe(false);
    expect(pushNotification).not.toHaveBeenCalled();
  });

  it("queues a move behind a running copy and checks its conflicts only when it starts, against the folder as the copy left it", async () => {
    const copyGate = createDeferred();
    let isCopyDone = false;
    mockTransferFolder({
      // The copy puts a.txt into the archive, where the move then finds it.
      conflicts: ({ sources }) => (isCopyDone && sources.includes("C:\\Users\\a.txt")
        ? [{ path: "C:\\Users\\a.txt", mergesFolders: false }]
        : []),
      onImport: async () => {
        await copyGate.promise;
        isCopyDone = true;
        return {};
      },
    });
    const openChoice = vi.fn(async () => "keep-both");
    const { result } = await renderTransferNavigation({ openChoice });
    const countConflictChecks = () => invoke.mock.calls
      .filter(([command]) => command === "filesystem_transfer_conflicts")
      .length;

    let copying;
    let moving;
    act(() => {
      copying = result.current.copyEntries(["C:\\Users\\a.txt"], "C:\\Archive");
      moving = result.current.moveEntries(["C:\\Users\\a.txt", "C:\\Users\\b.txt"], "C:\\Archive");
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("import_paths", expect.anything());
    });

    expect(getTabOperations(tabId).queued.map((operation) => operation.label)).toEqual(['Moving 2 items to "Archive"']);
    expect(countConflictChecks()).toBe(1);
    expect(openChoice).not.toHaveBeenCalled();

    let outcomes;
    await act(async () => {
      copyGate.resolve();
      outcomes = await Promise.all([copying, moving]);
    });

    expect(outcomes).toEqual(["done", "done"]);
    expect(countConflictChecks()).toBe(2);
    // Asked only now, without taking the keyboard from whatever the user does by then.
    expect(openChoice).toHaveBeenCalledTimes(1);
    expect(openChoice).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Moving 2 items to "Archive": Item already exists',
      takeFocus: false,
      dismissOnOutside: false,
    }));
    expect(invoke.mock.calls.filter(([command]) => command === "move_path").map(([, payload]) => payload.conflictPolicy))
      .toEqual(["keep-both", "keep-both"]);
  });

  it("keeps a pane's history across a remount with the same tab and pane ids", async () => {
    mockTransferFolder();
    const firstMount = await renderTransferNavigation();
    await act(async () => {
      await firstMount.result.current.moveEntries(["C:\\Users\\a.txt"], "C:\\Archive");
    });
    firstMount.unmount();

    const { result } = await renderTransferNavigation();
    const otherPane = renderNavigation({ currentDrive: "C:\\", currentPath: "C:\\Users" }, { paneId: "pane-right" });
    let otherPaneUndo;
    let undone;
    await act(async () => {
      otherPaneUndo = await otherPane.result.current.undoEntries();
      undone = await result.current.undoEntries();
    });

    expect(otherPaneUndo).toBeUndefined();
    expect(undone).toBe("done");
    expect(getMoveCalls()).toEqual(["C:\\Users\\a.txt -> C:\\Archive", "C:\\Archive\\a.txt -> C:\\Users"]);
  });

  it("takes back the pane's newest waiting operation on undo, leaves another pane's, and undoes nothing while one runs", async () => {
    const copyGate = createDeferred();
    mockTransferFolder({ onImport: () => copyGate.promise.then(() => ({})) });
    const { result } = await renderTransferNavigation();
    const otherPane = renderNavigation({ currentDrive: "C:\\", currentPath: "C:\\Users" }, { paneId: "pane-right" });
    // Something to undo, from before.
    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\a.txt"], "C:\\Archive");
    });

    let copying;
    let moving;
    let otherPaneMoving;
    let deleting;
    act(() => {
      copying = result.current.copyEntries(["C:\\Users\\b.txt"], "C:\\Backup");
      moving = result.current.moveEntries(["C:\\Users\\b.txt"], "C:\\Archive");
      otherPaneMoving = otherPane.result.current.moveEntries(["C:\\Users\\b.txt"], "C:\\Other");
      deleting = result.current.deleteEntries(["C:\\Users\\b.txt"]);
    });
    const undoOutcomes = [];
    await act(async () => {
      for (let press = 0; press < 3; press += 1) undoOutcomes.push(await result.current.undoEntries());
    });

    expect(undoOutcomes).toEqual(["dropped", "dropped", undefined]);
    expect(await deleting).toBe("dropped");
    expect(await moving).toBe("dropped");
    expect(getTabOperations(tabId).queued.map((operation) => operation.label)).toEqual(['Moving "b.txt" to "Other"']);
    expect(getPaneHistory(getPaneHistoryKey(tabId, PANE_ID)).undo).toHaveLength(1);

    let outcomes;
    await act(async () => {
      copyGate.resolve();
      outcomes = await Promise.all([copying, otherPaneMoving]);
    });
    await act(async () => {
      outcomes.push(await result.current.undoEntries());
    });

    expect(outcomes).toEqual(["done", "done", "done"]);
    expect(invoke).not.toHaveBeenCalledWith("delete_paths", expect.anything());
    expect(getMoveCalls()).toEqual([
      "C:\\Users\\a.txt -> C:\\Archive",
      "C:\\Users\\b.txt -> C:\\Other",
      // Once nothing runs, undo undoes the move from before.
      "C:\\Archive\\a.txt -> C:\\Users",
    ]);
  });

  it("replaces its own entry when a rename lands while an undo runs, so the next undo undoes the rename", async () => {
    const undoGate = createDeferred();
    let isUndoing = false;
    mockTransferFolder({
      onMove: async () => {
        if (isUndoing) await undoGate.promise;
        return { destination: null, merge: null };
      },
    });
    const { result } = await renderTransferNavigation();
    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\a.txt"], "C:\\Archive");
    });

    isUndoing = true;
    let undoing;
    act(() => {
      undoing = result.current.undoEntries();
    });
    // F2 in the pane while a.txt moves back.
    await act(async () => {
      await result.current.renameEntry("C:\\Users\\b.txt", "c.txt");
    });
    let undone;
    await act(async () => {
      undoGate.resolve();
      undone = await undoing;
    });
    let renameUndone;
    await act(async () => {
      renameUndone = await result.current.undoEntries();
    });

    expect([undone, renameUndone]).toEqual(["done", "done"]);
    expect(getMoveCalls()).toEqual(["C:\\Users\\a.txt -> C:\\Archive", "C:\\Archive\\a.txt -> C:\\Users"]);
    expect(invoke.mock.calls.filter(([command]) => command === "rename_path").map(([, payload]) => payload)).toEqual([
      { path: "C:\\Users\\b.txt", newName: "c.txt" },
      { path: "C:\\Users\\c.txt", newName: "b.txt", allowAdjustment: false },
    ]);
    expect(getPaneHistory(getPaneHistoryKey(tabId, PANE_ID)).undo).toEqual([]);
  });

  it("puts a move above a rename made while its question was open and below one made while it moved, so undo takes the newest first", async () => {
    const answer = createDeferred();
    const moveGate = createDeferred();
    mockTransferFolder({
      conflicts: [{ path: "C:\\Users\\a.txt", mergesFolders: false }],
      onMove: async () => {
        await moveGate.promise;
        return { destination: null, merge: null };
      },
    });
    const openChoice = vi.fn(() => answer.promise);
    const { result } = await renderTransferNavigation({ openChoice });

    let moving;
    act(() => {
      moving = result.current.moveEntries(["C:\\Users\\a.txt"], "C:\\Archive");
    });
    await waitFor(() => {
      expect(openChoice).toHaveBeenCalledTimes(1);
    });
    // F2 in the pane while the question is open, which is before the move.
    await act(async () => {
      await result.current.renameEntry("C:\\Users\\b.txt", "c.txt");
    });
    act(() => answer.resolve("keep-both"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({ source: "C:\\Users\\a.txt" }));
    });
    // And again while the move runs.
    await act(async () => {
      await result.current.renameEntry("C:\\Users\\c.txt", "d.txt");
    });
    await act(async () => {
      moveGate.resolve();
      await moving;
    });
    const callsBeforeUndo = invoke.mock.calls.length;

    const outcomes = [];
    for (let press = 0; press < 3; press += 1) {
      await act(async () => {
        outcomes.push(await result.current.undoEntries());
      });
    }

    expect(outcomes).toEqual(["done", "done", "done"]);
    expect(invoke.mock.calls.slice(callsBeforeUndo)
      .filter(([command]) => command === "rename_path" || command === "move_path")
      .map(([command, payload]) => (command === "move_path"
        ? `move ${payload.source} -> ${payload.destinationDir}`
        : `rename ${payload.path} -> ${payload.newName}`)))
      .toEqual([
        "rename C:\\Users\\d.txt -> c.txt",
        "move C:\\Archive\\a.txt -> C:\\Users",
        "rename C:\\Users\\c.txt -> b.txt",
      ]);
  });

  it("refreshes the folder on screen and drops moved items from the selection when an operation of its tab finishes, not one of another tab", async () => {
    mockTransferFolder();
    const { result } = await renderTransferNavigation();
    const otherTabPane = renderNavigation({ currentDrive: "C:\\", currentPath: "C:\\" }, { tabId: `${tabId}-other` });
    act(() => {
      result.current.selectEntry("C:\\Users\\a.txt");
    });
    act(() => {
      result.current.selectEntry("C:\\Users\\b.txt", { additive: true });
    });
    invoke.mockClear();
    const countUsersRefreshes = () => invoke.mock.calls
      .filter(([command, payload]) => command === "list_directory_page" && payload.path === "C:\\Users" && payload.refresh)
      .length;

    await act(async () => {
      await otherTabPane.result.current.moveEntries(["C:\\Users\\a.txt"], "C:\\Archive");
    });
    expect(countUsersRefreshes()).toBe(0);
    expect(result.current.selectedPaths).toEqual(["C:\\Users\\a.txt", "C:\\Users\\b.txt"]);

    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\a.txt"], "C:\\Archive");
    });
    expect(countUsersRefreshes()).toBe(1);
    expect(result.current.selectedPaths).toEqual(["C:\\Users\\b.txt"]);

    // Nor does an import into the folder clear what is selected there.
    await act(async () => {
      await result.current.importExternalPaths(["D:\\Downloads\\clip.mp4"], "C:\\Users");
    });
    expect(countUsersRefreshes()).toBe(2);
    expect(result.current.selectedPaths).toEqual(["C:\\Users\\b.txt"]);
  });

  it("lists nothing again after an operation cancelled at its conflict question", async () => {
    mockTransferFolder({ conflicts: [{ path: "C:\\Users\\a.txt", mergesFolders: false }] });
    const { result } = await renderTransferNavigation({ openChoice: async () => null });
    invoke.mockClear();

    let outcome;
    await act(async () => {
      outcome = await result.current.moveEntries(["C:\\Users\\a.txt"], "C:\\Archive");
    });

    expect(outcome).toBe("cancelled");
    expect(invoke).not.toHaveBeenCalledWith("list_directory_page", expect.anything());
  });

  // A listing loads at most MAX_REFRESH_ENTRY_COUNT (360) entries again and drops the selection
  // beyond them, so a pane far down a long folder would lose its place.
  it("lists a folder again only in the panes showing one the operation changed, not its parent or a subfolder, so another keeps its long listing and selection", async () => {
    const photos = Array.from({ length: 400 }, (_, index) => {
      const name = `${String(index).padStart(3, "0")}.jpg`;
      return { name, path: `E:\\Photos\\${name}`, is_dir: false };
    });
    mockTransferFolder();
    const answer = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => {
      if (command !== "list_directory_page" || payload.path !== "E:\\Photos") return answer(command, payload);
      const entries = photos.slice(payload.offset, payload.offset + payload.limit);
      return { entries, hasMore: payload.offset + entries.length < photos.length, totalCount: photos.length };
    });
    const { result } = await renderTransferNavigation();
    const photosPane = renderNavigation({ currentDrive: "E:\\", currentPath: "E:\\Photos" }, { paneId: "pane-right" });
    await waitFor(() => {
      expect(photosPane.result.current.entries).toHaveLength(120);
    });
    // Scrolled down to the end.
    for (let page = 0; page < 3; page += 1) {
      await act(async () => {
        await photosPane.result.current.loadMoreEntries();
      });
    }
    act(() => {
      photosPane.result.current.selectEntry("E:\\Photos\\380.jpg");
    });
    invoke.mockClear();

    for (const destinationDir of ["C:\\Archive", "E:\\Photos\\Edited", "E:\\"]) {
      await act(async () => {
        await result.current.copyEntries(["C:\\Users\\a.txt"], destinationDir);
      });
    }
    await flushPromises();

    // Neither the copies' own pane nor the other shows a destination. A folder inside the one shown,
    // or the one it is in, has a listing of its own.
    expect(invoke).not.toHaveBeenCalledWith("list_directory_page", expect.anything());
    expect(photosPane.result.current.entries).toHaveLength(400);
    expect(photosPane.result.current.selectedPaths).toEqual(["E:\\Photos\\380.jpg"]);
  });

  // What was copied or deleted by then stays so.
  it("lists the folder on screen again after a copy into it was cancelled part way", async () => {
    let rejectImport;
    mockTransferFolder({
      onImport: () => new Promise((_resolve, reject) => {
        rejectImport = reject;
      }),
    });
    const { result } = await renderTransferNavigation();
    let copyPromise;
    act(() => {
      copyPromise = result.current.importExternalPaths(["D:\\Downloads\\a.mp4", "D:\\Downloads\\b.mp4"], "C:\\Users");
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("import_paths", expect.anything());
    });
    invoke.mockClear();

    act(() => cancelRunningOperation());
    let outcome;
    await act(async () => {
      rejectImport(new Error("The transfer was cancelled."));
      outcome = await copyPromise;
    });

    expect(outcome).toBe("cancelled");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_directory_page", expect.objectContaining({ path: "C:\\Users", refresh: true }));
    });
  });

  it("lists the folder on screen again after a delete in it failed", async () => {
    mockTransferFolder({
      onDelete: async () => {
        throw "Access is denied. (os error 5)";
      },
    });
    const { result } = await renderTransferNavigation({ pushNotification: vi.fn() });
    invoke.mockClear();

    let outcome;
    await act(async () => {
      outcome = await result.current.deleteEntries(["C:\\Users\\a.txt", "C:\\Users\\b.txt"]);
    });

    expect(outcome).toBe("failed");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_directory_page", expect.objectContaining({ path: "C:\\Users", refresh: true }));
    });
  });

  it("reruns a search when an operation changed a folder inside the searched one, not one elsewhere", async () => {
    mockTransferFolder();
    const { result } = await renderTransferNavigation();
    const countSearchStarts = () => invoke.mock.calls
      .filter(([command]) => command === "filesystem_search_start")
      .length;
    act(() => {
      result.current.setSearchQuery("txt");
    });
    await waitFor(() => {
      expect(countSearchStarts()).toBe(1);
    });

    await act(async () => {
      await result.current.copyEntries(["C:\\Users\\a.txt"], "C:\\Archive");
    });
    // Longer than the search waits before it reruns.
    await flushPromises(200);
    expect(countSearchStarts()).toBe(1);

    await act(async () => {
      await result.current.copyEntries(["C:\\Users\\a.txt"], "C:\\Users\\Notes");
    });
    await waitFor(() => {
      expect(countSearchStarts()).toBe(2);
    });
  });

  it("shows a Delete failed toast that leaves the focus alone, not an error in the status line", async () => {
    mockTransferFolder({
      onDelete: async () => {
        throw "Access is denied. (os error 5)";
      },
    });
    const pushNotification = vi.fn();
    const { result } = await renderTransferNavigation({ pushNotification });

    let outcome;
    await act(async () => {
      outcome = await result.current.deleteEntries(["C:\\Users\\a.txt"]);
    });

    expect(outcome).toBe("failed");
    expect(pushNotification).toHaveBeenCalledWith({
      title: "Delete failed",
      message: "Access is denied. (os error 5)",
      tone: "error",
      takeFocus: false,
    });
    expect(result.current.error).toBe("");
  });
});
