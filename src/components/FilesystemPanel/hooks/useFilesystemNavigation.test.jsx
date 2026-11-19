import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import useFilesystemNavigation from "./useFilesystemNavigation";
import { runInAsyncAct } from "../../../test/utils/actCallbacks";
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

describe("useFilesystemNavigation", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockClear();
    filesystemWatchHandler = undefined;
  });

  it("starts and stops a watcher as browsing state changes", async () => {
    mockFilesystemInvoke();

    const { result } = renderHook(() => useFilesystemNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\",
    }));

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

    const { result } = renderHook(() => useFilesystemNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\",
    }));

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

    const { result } = renderHook(() => useFilesystemNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\",
      selectedPaths: ["C:\\Users"],
    }));

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

    const { result } = renderHook(() => useFilesystemNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\Users",
      selectedPaths: ["C:\\Users\\todo.txt"],
    }));

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

    const { result } = renderHook(() => useFilesystemNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\",
    }));

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

    await act(async () => {
      await result.current.deleteEntries(["C:\\todo.txt"]);
    });

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

    const { result } = renderHook(() => useFilesystemNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\Users",
    }));

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual([
        "C:\\Users\\todo.txt",
      ]);
    });

    let movePromise;
    act(() => {
      movePromise = result.current.moveEntries(
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
      await movePromise;
    });

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

    const { result } = renderHook(() => useFilesystemNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\Users",
    }));

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
    const { result } = renderHook(() => useFilesystemNavigation(
      { currentDrive: "C:\\", currentPath: "C:\\Users" },
      { openChoice: async () => "replace" },
    ));
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

    expect(undone).toBe(true);
    expect(redone).toBe(true);
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
      result.current.cancelTransfer();
      return {
        destination: "C:\\Archive\\Photos",
        merge: {
          movedItems: [{ sourcePath: "C:\\Users\\Photos\\new.jpg", destinationPath: "C:\\Archive\\Photos\\new.jpg" }],
          removedFolders: [],
        },
      };
    });
    ({ result } = renderHook(() => useFilesystemNavigation(
      { currentDrive: "C:\\", currentPath: "C:\\Users" },
      { openChoice: async () => "replace" },
    )));
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
    const hook = renderHook(() => useFilesystemNavigation(
      { currentDrive: "C:\\", currentPath: "C:\\Users" },
      { openChoice: async () => "replace", pushNotification },
    ));
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

    await act(async () => {
      await expect(result.current.moveEntries(["C:\\Users\\Photos", "C:\\Users\\notes.txt"], "C:\\Archive"))
        .rejects.toBe(lockedError("C:\\Users\\notes.txt"));
    });
    let undone;
    await act(async () => {
      undone = await result.current.undoEntries();
    });

    expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Move failed",
      message: lockedError("C:\\Users\\notes.txt"),
    }));
    expect(undone).toBe(true);
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

    await act(async () => {
      await expect(result.current.moveEntries(["C:\\Users\\Photos", "C:\\Users\\notes.txt"], "C:\\Archive"))
        .rejects.toBe(lockedError("C:\\Users\\Photos\\b.jpg"));
    });
    await act(async () => {
      await result.current.undoEntries();
    });

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
    let result;
    let cancelOnce = true;
    mockFolderMerge(mergeOfThree);
    interceptInvoke((command, payload) => {
      // Cancel is clicked while the first undo moves c.jpg back.
      if (cancelOnce && command === "move_path" && payload.source === "C:\\Archive\\Photos\\c.jpg") {
        cancelOnce = false;
        result.current.cancelTransfer();
      }
    });
    result = await renderMergeNavigation();

    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\Photos"], "C:\\Archive");
    });
    const outcomes = [];
    for (const step of ["undoEntries", "redoEntries", "undoEntries", "undoEntries", "undoEntries"]) {
      await act(async () => {
        outcomes.push(await result.current[step]());
      });
    }

    expect(outcomes).toEqual([true, true, true, true, false]);
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

    expect(outcomes).toEqual([false, true, true, true]);
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
    expect(outcomes).toEqual([false, false, true]);
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

    expect(moved).toHaveLength(200000);
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

    expect(undone).toBe(true);
    expect(redone).toBe(true);
    expect(getMoveHistoryCalls()).toEqual([
      "move C:\\Users\\Photos -> C:\\Archive (replace)",
      "recreate_folders C:\\Users\\Photos\\2019, C:\\Users\\Photos",
      "remove_empty_folders C:\\Users\\Photos\\2019, C:\\Users\\Photos",
    ]);
    expect(refreshesAfterUndo).toBe(refreshesBefore + 1);
    expect(countRefreshes()).toBe(refreshesAfterUndo + 1);
  });

  it("keeps the pane busy while undo recreates folders and redo removes them", async () => {
    mockFolderMerge(mergeOfThree);
    const result = await renderMergeNavigation();
    await act(async () => {
      await result.current.moveEntries(["C:\\Users\\Photos"], "C:\\Archive");
    });
    const gates = {
      recreate_folders: Promise.withResolvers(),
      remove_empty_folders: Promise.withResolvers(),
    };
    interceptInvoke((command) => gates[command]?.promise);

    let undoing;
    await act(async () => {
      undoing = result.current.undoEntries();
    });
    const busyWhileRecreating = result.current.isMovingEntry;
    await act(async () => {
      gates.recreate_folders.resolve();
      await undoing;
    });
    let redoing;
    await act(async () => {
      redoing = result.current.redoEntries();
    });
    const busyWhileRemoving = result.current.isMovingEntry;
    await act(async () => {
      gates.remove_empty_folders.resolve();
      await redoing;
    });

    expect(busyWhileRecreating).toBe(true);
    expect(busyWhileRemoving).toBe(true);
    expect(result.current.isMovingEntry).toBe(false);
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

    const { result } = renderHook(() => useFilesystemNavigation(
      { currentDrive: "C:\\", currentPath: "C:\\Users" },
      { pushNotification },
    ));

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users\\todo.txt"]);
    });

    await act(async () => {
      await expect(result.current.moveEntries(["C:\\Users\\todo.txt"], "C:\\Archive")).rejects.toThrow(
        "already exists",
      );
    });

    expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Move failed",
      tone: "error",
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

    const { result } = renderHook(() => useFilesystemNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\Users",
    }));

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

    const { result } = renderHook(() => useFilesystemNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\Users",
    }));

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual([
        "C:\\Users\\todo.txt",
      ]);
    });

    let importPromise;
    act(() => {
      importPromise = result.current.importExternalPaths(["D:\\Downloads\\clip.mp4"]);
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
      await importPromise;
    });

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

    const { result } = renderHook(() => useFilesystemNavigation(
      { currentDrive: "C:\\", currentPath: "C:\\Users" },
      { pushNotification },
    ));

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users\\todo.txt"]);
    });

    await act(async () => {
      await expect(result.current.copyEntries(["C:\\Users\\todo.txt"], "C:\\Archive")).rejects.toThrow(
        "already exists",
      );
    });

    expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Copy failed",
      tone: "error",
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

    const { result } = renderHook(() => useFilesystemNavigation(
      { currentDrive: "C:\\", currentPath: "C:\\Users" },
      { pushNotification },
    ));

    await waitFor(() => {
      expect(result.current.entries.map((entry) => entry.path)).toEqual(["C:\\Users\\todo.txt"]);
    });

    await act(async () => {
      await expect(
        result.current.importExternalPaths(["D:\\Downloads\\clip.mp4"], "C:\\Users"),
      ).rejects.toThrow("Access is denied");
    });

    expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Import failed",
      tone: "error",
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

    const { result } = renderHook(() => useFilesystemNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\",
    }));

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

    const { result } = renderHook(() => useFilesystemNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\",
    }));

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

    const { result } = renderHook(() => useFilesystemNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\",
    }));

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

  function mockTransferFolder({
    conflicts = [],
    onImport = async () => ({}),
    onMove = async () => ({ destination: null, merge: null }),
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
      if (command === "filesystem_transfer_conflicts") return conflicts;
      if (command === "import_paths") return onImport(payload);
      if (command === "move_path") return onMove(payload);
      if (command === "filesystem_transfer_cancel") return null;
      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") return null;
      throw new Error(`Unhandled invoke: ${command}`);
    });
  }

  async function renderTransferNavigation(options) {
    const hook = renderHook(() => useFilesystemNavigation(
      { currentDrive: "C:\\", currentPath: "C:\\Users" },
      options,
    ));
    await waitFor(() => {
      expect(hook.result.current.entries).toHaveLength(2);
    });
    return hook;
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
    await act(async () => {
      await result.current.copyEntries(["C:\\Users\\a.txt"], "C:\\Archive");
    });
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
    expect(undone).toBe(true);
    expect(afterUndo).toEqual(["C:\\Archive\\a.txt", "C:\\Users\\a.txt"]);
    expect(redone).toBe(true);
    expect(sortedFiles()).toEqual(["C:\\Archive\\a (2).txt", "C:\\Archive\\a.txt"]);
  });

  it("shows copy progress and treats a cancelled copy as no error", async () => {
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
      expect(result.current.transferProgress).toMatchObject({ kind: "copy", itemsTotal: 2 });
    });

    act(() => result.current.cancelTransfer());
    expect(invoke).toHaveBeenCalledWith("filesystem_transfer_cancel", {
      jobId: expect.stringMatching(/^filesystem-transfer-/),
    });
    await act(async () => {
      rejectImport(new Error("The transfer was cancelled."));
      await copyPromise;
    });

    expect(result.current.transferProgress).toBeNull();
    expect(pushNotification).not.toHaveBeenCalled();
  });
});
