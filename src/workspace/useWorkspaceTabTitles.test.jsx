import { renderHook, waitFor } from "@testing-library/react";
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
