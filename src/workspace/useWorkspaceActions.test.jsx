import { act, renderHook } from "@testing-library/react";
import useWorkspaceActions from "./useWorkspaceActions";
import {
  workspaceCloseTab,
  workspaceCloseTabPane,
  workspaceNewTab,
  workspaceSetActiveTab,
  workspaceSetTabActivePane,
  workspaceSetTabLayoutSplitRatio,
  workspaceSetTabPaneFilesystemState,
  workspaceSetTabPanelType,
  workspaceSetTabSelectedFiles,
  workspaceSetTabTerminalCwd,
  workspaceSetTabWorkspaceRoot,
  workspaceSplitTabPane,
} from "./workspaceApi";

vi.mock("./workspaceApi", () => ({
  workspaceCloseTab: vi.fn(),
  workspaceCloseTabPane: vi.fn(),
  workspaceNewTab: vi.fn(),
  workspaceSetActiveTab: vi.fn(),
  workspaceSetTabActivePane: vi.fn(),
  workspaceSetTabLayoutSplitRatio: vi.fn(),
  workspaceSetTabPaneFilesystemState: vi.fn(),
  workspaceSetTabPanelType: vi.fn(),
  workspaceSetTabSelectedFiles: vi.fn(),
  workspaceSetTabTerminalCwd: vi.fn(),
  workspaceSetTabWorkspaceRoot: vi.fn(),
  workspaceSplitTabPane: vi.fn(),
}));

const resolvedCommands = [
  workspaceCloseTab,
  workspaceCloseTabPane,
  workspaceNewTab,
  workspaceSetActiveTab,
  workspaceSetTabActivePane,
  workspaceSetTabLayoutSplitRatio,
  workspaceSetTabPaneFilesystemState,
  workspaceSetTabPanelType,
  workspaceSetTabSelectedFiles,
  workspaceSetTabTerminalCwd,
  workspaceSetTabWorkspaceRoot,
  workspaceSplitTabPane,
];

describe("useWorkspaceActions handleSetTabCwdHint", () => {
  beforeEach(() => {
    resolvedCommands.forEach((commandMock) => {
      commandMock.mockReset();
      commandMock.mockResolvedValue(null);
    });
  });

  it("clears workspace root when active pane path leaves the workspace", async () => {
    const activeTab = {
      tabId: "tab-1",
      activePaneId: "pane-1",
      workspaceRoot: "C:\\workspace",
      paneStates: {},
    };
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab,
    }));

    await act(async () => {
      result.current.handleSetTabCwdHint("tab-1", "pane-1", "C:\\");
      await Promise.resolve();
    });

    expect(workspaceSetTabTerminalCwd).toHaveBeenCalledWith("tab-1", "C:\\");
    expect(workspaceSetTabWorkspaceRoot).toHaveBeenCalledWith("tab-1", null);
  });

  it("keeps workspace root when active pane path stays inside the workspace", async () => {
    const activeTab = {
      tabId: "tab-1",
      activePaneId: "pane-1",
      workspaceRoot: "C:\\workspace",
      paneStates: {},
    };
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab,
    }));

    await act(async () => {
      result.current.handleSetTabCwdHint("tab-1", "pane-1", "C:\\workspace\\src");
      await Promise.resolve();
    });

    expect(workspaceSetTabTerminalCwd).toHaveBeenCalledWith("tab-1", "C:\\workspace\\src");
    expect(workspaceSetTabWorkspaceRoot).not.toHaveBeenCalled();
  });

  it("does not resend terminal cwd when path is unchanged", async () => {
    const activeTab = {
      tabId: "tab-1",
      activePaneId: "pane-1",
      terminalCwdHint: "C:\\workspace\\src",
      workspaceRoot: "C:\\workspace",
      paneStates: {},
    };
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab,
    }));

    await act(async () => {
      result.current.handleSetTabCwdHint("tab-1", "pane-1", "C:\\workspace\\src");
      await Promise.resolve();
    });

    expect(workspaceSetTabTerminalCwd).not.toHaveBeenCalled();
    expect(workspaceSetTabWorkspaceRoot).not.toHaveBeenCalled();
  });

  it("dedupes repeated path updates before tab snapshot catches up", async () => {
    const activeTab = {
      tabId: "tab-1",
      activePaneId: "pane-1",
      terminalCwdHint: "",
      workspaceRoot: "C:\\workspace",
      paneStates: {},
    };
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab,
    }));

    await act(async () => {
      result.current.handleSetTabCwdHint("tab-1", "pane-1", "C:\\workspace\\src");
      result.current.handleSetTabCwdHint("tab-1", "pane-1", "C:\\workspace\\src");
      await Promise.resolve();
    });

    expect(workspaceSetTabTerminalCwd).toHaveBeenCalledTimes(1);
    expect(workspaceSetTabTerminalCwd).toHaveBeenCalledWith("tab-1", "C:\\workspace\\src");
  });
});
