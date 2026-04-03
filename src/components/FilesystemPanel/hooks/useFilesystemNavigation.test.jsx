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
        return null;

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
        return null;

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

        return destinationPath;
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
        return null;

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
});
