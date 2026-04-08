import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import useWorkspaceTabTitles from "./useWorkspaceTabTitles";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("useWorkspaceTabTitles", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(null);
  });

  it("uses the opened folder name for non-workspace tabs", () => {
    const tabs = [
      {
        tabId: "tab-1",
        title: "Tab 1",
        workspaceRoot: null,
        activePaneId: "pane-a",
        paneStates: {
          "pane-a": {
            panelType: "Filesystem",
            filesystemState: {
              currentPath: "C:\\Users\\Projects",
            },
          },
        },
      },
    ];

    const { result } = renderHook(() => useWorkspaceTabTitles(tabs));

    expect(result.current["tab-1"]).toBe("Projects");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("prefixes workspace tabs with ws and falls back to folder name", async () => {
    const tabs = [
      {
        tabId: "tab-1",
        title: "Tab 1",
        workspaceRoot: "C:\\Users\\WorkspaceA",
        activePaneId: "pane-a",
        paneStates: {},
      },
    ];

    const { result } = renderHook(() => useWorkspaceTabTitles(tabs));

    expect(result.current["tab-1"]).toBe("ws: WorkspaceA");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("workspace_read_folder_config", {
        workspaceRoot: "C:\\Users\\WorkspaceA",
      });
    });
  });

  it("uses folder.json name for workspace tabs", async () => {
    invoke.mockResolvedValue("{ name: 'Alpha Workspace', }");
    const tabs = [
      {
        tabId: "tab-1",
        title: "Tab 1",
        workspaceRoot: "C:\\Users\\WorkspaceA",
        activePaneId: "pane-a",
        paneStates: {},
      },
    ];

    const { result } = renderHook(() => useWorkspaceTabTitles(tabs));

    await waitFor(() => {
      expect(result.current["tab-1"]).toBe("ws: Alpha Workspace");
    });
  });

  it("falls back to folder name when folder.json is malformed", async () => {
    invoke.mockResolvedValue("{ invalid_json:");
    const tabs = [
      {
        tabId: "tab-1",
        title: "Tab 1",
        workspaceRoot: "C:\\Users\\WorkspaceA",
        activePaneId: "pane-a",
        paneStates: {},
      },
    ];

    const { result } = renderHook(() => useWorkspaceTabTitles(tabs));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("workspace_read_folder_config", {
        workspaceRoot: "C:\\Users\\WorkspaceA",
      });
      expect(result.current["tab-1"]).toBe("ws: WorkspaceA");
    });
  });

  it("falls back to folder name when workspace config read fails", async () => {
    invoke.mockRejectedValue(new Error("Read failed."));
    const tabs = [
      {
        tabId: "tab-1",
        title: "Tab 1",
        workspaceRoot: "C:\\Users\\WorkspaceA",
        activePaneId: "pane-a",
        paneStates: {},
      },
    ];

    const { result } = renderHook(() => useWorkspaceTabTitles(tabs));

    await waitFor(() => {
      expect(result.current["tab-1"]).toBe("ws: WorkspaceA");
    });
  });

  it("uses trimmed workspace root for lookup and config reads", async () => {
    invoke.mockResolvedValue("{ name: 'Trimmed Workspace', }");
    const tabs = [
      {
        tabId: "tab-1",
        title: "Tab 1",
        workspaceRoot: "   C:\\Users\\WorkspaceA\\   ",
        activePaneId: "pane-a",
        paneStates: {},
      },
    ];

    const { result } = renderHook(() => useWorkspaceTabTitles(tabs));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("workspace_read_folder_config", {
        workspaceRoot: "C:\\Users\\WorkspaceA\\",
      });
      expect(result.current["tab-1"]).toBe("ws: Trimmed Workspace");
    });
  });

  it("uses first filesystem pane with a path when active pane is not filesystem", () => {
    const tabs = [
      {
        tabId: "tab-1",
        title: "Fallback tab",
        workspaceRoot: null,
        activePaneId: "pane-preview",
        paneStates: {
          "pane-preview": {
            panelType: "Preview",
          },
          "pane-fs": {
            panelType: "Filesystem",
            filesystemState: {
              currentPath: "D:\\Projects\\Alpha",
            },
          },
        },
      },
    ];

    const { result } = renderHook(() => useWorkspaceTabTitles(tabs));

    expect(result.current["tab-1"]).toBe("Alpha");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("falls back to another filesystem pane when active filesystem pane path is empty", () => {
    const tabs = [
      {
        tabId: "tab-1",
        title: "Fallback tab",
        workspaceRoot: null,
        activePaneId: "pane-fs-empty",
        paneStates: {
          "pane-fs-empty": {
            panelType: "Filesystem",
            filesystemState: {
              currentPath: "",
            },
          },
          "pane-fs": {
            panelType: "Filesystem",
            filesystemState: {
              currentPath: "D:\\Projects\\Alpha",
            },
          },
        },
      },
    ];

    const { result } = renderHook(() => useWorkspaceTabTitles(tabs));

    expect(result.current["tab-1"]).toBe("Alpha");
  });

  it("uses tab title when no filesystem pane has a root path", () => {
    const tabs = [
      {
        tabId: "tab-1",
        title: "No folder open",
        workspaceRoot: null,
        activePaneId: "pane-preview",
        paneStates: {
          "pane-preview": {
            panelType: "Preview",
          },
          "pane-fs": {
            panelType: "Filesystem",
            filesystemState: {
              currentPath: "",
            },
          },
        },
      },
    ];

    const { result } = renderHook(() => useWorkspaceTabTitles(tabs));

    expect(result.current["tab-1"]).toBe("No folder open");
  });

  it("uses empty string when no folder path and no tab title are available", () => {
    const tabs = [
      {
        tabId: "tab-1",
        workspaceRoot: null,
        activePaneId: "pane-preview",
        paneStates: {
          "pane-preview": {
            panelType: "Preview",
          },
        },
      },
    ];

    const { result } = renderHook(() => useWorkspaceTabTitles(tabs));

    expect(result.current["tab-1"]).toBe("");
  });

  it("does not apply late workspace-name updates after hook unmount", async () => {
    let resolveConfig;
    invoke.mockImplementation(
      () => new Promise((resolve) => {
        resolveConfig = resolve;
      }),
    );
    const tabs = [
      {
        tabId: "tab-1",
        title: "Tab 1",
        workspaceRoot: "C:\\Users\\WorkspaceA",
        activePaneId: "pane-a",
        paneStates: {},
      },
    ];

    const { unmount } = renderHook(() => useWorkspaceTabTitles(tabs));

    unmount();
    await act(async () => {
      resolveConfig("{ name: 'Late Workspace Name', }");
      await Promise.resolve();
    });

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not re-read workspace names on every snapshot while workspace stays open", async () => {
    invoke
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("{ name: 'Workspace Renamed', }");

    const makeTabs = () => ([
      {
        tabId: "tab-1",
        title: "Tab 1",
        workspaceRoot: "C:\\Users\\WorkspaceA",
        activePaneId: "pane-a",
        paneStates: {},
      },
    ]);

    const { result, rerender } = renderHook(({ tabs }) => useWorkspaceTabTitles(tabs), {
      initialProps: { tabs: makeTabs() },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(result.current["tab-1"]).toBe("ws: WorkspaceA");
    });

    rerender({ tabs: makeTabs() });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(result.current["tab-1"]).toBe("ws: WorkspaceA");
    });
  });

  it("re-reads workspace name when workspace is loaded again", async () => {
    invoke
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("{ name: 'Workspace Renamed', }");
    const tabsWithWorkspace = [
      {
        tabId: "tab-1",
        title: "Tab 1",
        workspaceRoot: "C:\\Users\\WorkspaceA",
        activePaneId: "pane-a",
        paneStates: {},
      },
    ];

    const { result, rerender } = renderHook(({ tabs }) => useWorkspaceTabTitles(tabs), {
      initialProps: { tabs: tabsWithWorkspace },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(result.current["tab-1"]).toBe("ws: WorkspaceA");
    });

    rerender({ tabs: [] });
    rerender({ tabs: tabsWithWorkspace });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(result.current["tab-1"]).toBe("ws: Workspace Renamed");
    });
  });
});
