import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import useFilesystemNavigation from "./useFilesystemNavigation";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

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

    throw new Error(`Unhandled invoke: ${command}`);
  });
}

describe("useFilesystemNavigation", () => {
  beforeEach(() => {
    invoke.mockReset();
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
});
