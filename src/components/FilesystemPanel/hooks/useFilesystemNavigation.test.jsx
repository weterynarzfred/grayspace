import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import useFilesystemNavigation from "./useFilesystemNavigation";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

let filesystemWatchHandler;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName, handler) => {
    if (eventName === "filesystem-watch-event") {
      filesystemWatchHandler = handler;
    }
    return () => {
      if (filesystemWatchHandler === handler) filesystemWatchHandler = undefined;
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
  invoke.mockImplementation(async (command, payload) => {
    if (command === "list_drives") {
      return [{ name: "C:", path: "C:\\" }];
    }

    if (command === "list_directory") {
      if (payload?.path === "C:\\") {
        return [{ name: "Users", path: "C:\\Users", is_dir: true }];
      }

      if (payload?.path === "C:\\Users") {
        return [{ name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false }];
      }

      return [];
    }

    if (command === "parent_path") {
      if (payload?.path === "C:\\Users") {
        return parentPathForUsers;
      }

      if (payload?.path === "C:\\") {
        return null;
      }

      return null;
    }

    if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") {
      return null;
    }

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
      if (command === "list_drives") {
        return [{ name: "C:", path: "C:\\" }];
      }

      if (command === "list_directory") {
        const currentCount = (listDirectoryCallCount.get(payload?.path ?? "") ?? 0) + 1;
        listDirectoryCallCount.set(payload?.path ?? "", currentCount);

        if (payload?.path === "C:\\") {
          if (currentCount === 1) {
            return [{ name: "Users", path: "C:\\Users", is_dir: true }];
          }
          return [
            { name: "Users", path: "C:\\Users", is_dir: true },
            { name: "new.txt", path: "C:\\new.txt", is_dir: false },
          ];
        }

        return [];
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") {
        return null;
      }

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

    await act(async () => {
      filesystemWatchHandler?.({
        payload: {
          watchId,
          changedPath: "C:\\new.txt",
        },
      });
      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
    });

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
      selectedPath: "C:\\Users",
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
    expect(result.current.selectedPath).toBe("");
    expect(invoke).not.toHaveBeenCalledWith("parent_path", expect.anything());
  });

  it("clears browsing state when parent path escapes current drive", async () => {
    mockFilesystemInvoke({ parentPathForUsers: "D:\\" });

    const { result } = renderHook(() => useFilesystemNavigation({
      currentDrive: "C:\\",
      currentPath: "C:\\Users",
      selectedPath: "C:\\Users\\todo.txt",
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
    expect(result.current.selectedPath).toBe("");
  });

  it("ignores stale move refresh results after navigating to a different folder", async () => {
    const staleRefresh = createDeferred();
    const listDirectoryCallCount = new Map();

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives") {
        return [{ name: "C:", path: "C:\\" }];
      }

      if (command === "list_directory") {
        const path = payload?.path ?? "";
        const nextCount = (listDirectoryCallCount.get(path) ?? 0) + 1;
        listDirectoryCallCount.set(path, nextCount);

        if (path === "C:\\Users") {
          if (nextCount === 1) {
            return [{ name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false }];
          }
          return staleRefresh.promise;
        }

        if (path === "C:\\Projects") {
          return [{ name: "readme.md", path: "C:\\Projects\\readme.md", is_dir: false }];
        }

        return [];
      }

      if (command === "move_path") {
        return null;
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") {
        return null;
      }

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

  it("ignores stale import refresh results after navigating to a different folder", async () => {
    const staleRefresh = createDeferred();
    const listDirectoryCallCount = new Map();

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives") {
        return [{ name: "C:", path: "C:\\" }];
      }

      if (command === "list_directory") {
        const path = payload?.path ?? "";
        const nextCount = (listDirectoryCallCount.get(path) ?? 0) + 1;
        listDirectoryCallCount.set(path, nextCount);

        if (path === "C:\\Users") {
          if (nextCount === 1) {
            return [{ name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false }];
          }
          return staleRefresh.promise;
        }

        if (path === "C:\\Projects") {
          return [{ name: "readme.md", path: "C:\\Projects\\readme.md", is_dir: false }];
        }

        return [];
      }

      if (command === "import_paths") {
        return null;
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") {
        return null;
      }

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
});
