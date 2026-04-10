import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import useWorkspaceActions from "./useWorkspaceActions";
import {
  workspaceCloseTab,
  workspaceCloseTabPane,
  workspaceNewWindow,
  workspaceNewTab,
  workspaceSetActiveTab,
  workspaceSetTabActivePane,
  workspaceSetTabLayoutSplitRatio,
  workspaceSetTabPaneFilesystemState,
  workspaceSetTabPanelType,
  workspaceReplaceTabFolder,
  workspaceRecentFoldersRecord,
  workspaceSetTabSelectedFiles,
  workspaceSetTabTerminalCwd,
  workspaceSetTabWorkspaceRoot,
  workspaceSplitTabPane,
} from "./workspaceApi";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("./workspaceApi", () => ({
  workspaceCloseTab: vi.fn(),
  workspaceCloseTabPane: vi.fn(),
  workspaceNewWindow: vi.fn(),
  workspaceNewTab: vi.fn(),
  workspaceSetActiveTab: vi.fn(),
  workspaceSetTabActivePane: vi.fn(),
  workspaceSetTabLayoutSplitRatio: vi.fn(),
  workspaceSetTabPaneFilesystemState: vi.fn(),
  workspaceSetTabPanelType: vi.fn(),
  workspaceReplaceTabFolder: vi.fn(),
  workspaceRecentFoldersRecord: vi.fn(),
  workspaceSetTabSelectedFiles: vi.fn(),
  workspaceSetTabTerminalCwd: vi.fn(),
  workspaceSetTabWorkspaceRoot: vi.fn(),
  workspaceSplitTabPane: vi.fn(),
}));

const resolvedCommands = [
  workspaceCloseTab,
  workspaceCloseTabPane,
  workspaceNewWindow,
  workspaceNewTab,
  workspaceSetActiveTab,
  workspaceSetTabActivePane,
  workspaceSetTabLayoutSplitRatio,
  workspaceSetTabPaneFilesystemState,
  workspaceSetTabPanelType,
  workspaceReplaceTabFolder,
  workspaceRecentFoldersRecord,
  workspaceSetTabSelectedFiles,
  workspaceSetTabTerminalCwd,
  workspaceSetTabWorkspaceRoot,
  workspaceSplitTabPane,
];

function createActiveTab(overrides = {}) {
  return {
    tabId: "tab-1",
    activePaneId: "pane-1",
    workspaceRoot: "C:\\workspace",
    paneStates: {},
    ...overrides,
  };
}

describe("useWorkspaceActions handleSetTabCwdHint", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(null);
    resolvedCommands.forEach((commandMock) => {
      commandMock.mockReset();
      commandMock.mockResolvedValue(null);
    });
  });

  it("clears workspace root when active pane path leaves the workspace", async () => {
    const activeTab = createActiveTab();
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
    const activeTab = createActiveTab();
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

  it("clears workspace root even when the changing pane is not the active pane", async () => {
    const activeTab = createActiveTab({
      activePaneId: "pane-preview",
    });
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab,
    }));

    await act(async () => {
      result.current.handleSetTabCwdHint("tab-1", "pane-filesystem", "C:\\");
      await Promise.resolve();
    });

    expect(workspaceSetTabTerminalCwd).toHaveBeenCalledWith("tab-1", "C:\\");
    expect(workspaceSetTabWorkspaceRoot).toHaveBeenCalledWith("tab-1", null);
  });

  it("does not resend terminal cwd when path is unchanged", async () => {
    const activeTab = createActiveTab({
      activePaneId: "pane-1",
      terminalCwdHint: "C:\\workspace\\src",
    });
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
    expect(workspaceRecentFoldersRecord).not.toHaveBeenCalled();
  });

  it("does not clear workspace root for updates from a non-active tab", async () => {
    const activeTab = createActiveTab();
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab,
    }));

    await act(async () => {
      result.current.handleSetTabCwdHint("tab-2", "pane-1", "D:\\");
      await Promise.resolve();
    });

    expect(workspaceSetTabTerminalCwd).toHaveBeenCalledWith("tab-2", "D:\\");
    expect(workspaceSetTabWorkspaceRoot).not.toHaveBeenCalled();
  });

  it("dedupes repeated path updates before tab snapshot catches up", async () => {
    const activeTab = createActiveTab({
      terminalCwdHint: "",
    });
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
    expect(workspaceRecentFoldersRecord).toHaveBeenCalledTimes(1);
    expect(workspaceRecentFoldersRecord).toHaveBeenCalledWith("C:\\workspace\\src");
  });
});

describe("useWorkspaceActions basic commands", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(null);
    resolvedCommands.forEach((commandMock) => {
      commandMock.mockReset();
      commandMock.mockResolvedValue(null);
    });
  });

  it("creates a new window", async () => {
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab: createActiveTab(),
    }));

    await act(async () => {
      result.current.handleCreateWindow();
      await Promise.resolve();
    });

    expect(workspaceNewWindow).toHaveBeenCalledTimes(1);
  });

  it("sets active tab in current window", async () => {
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab: createActiveTab(),
    }));

    await act(async () => {
      result.current.handleSetActiveTab("tab-2");
      await Promise.resolve();
    });

    expect(workspaceSetActiveTab).toHaveBeenCalledWith("window-1", "tab-2");
  });

  it("creates and closes tab in current window", async () => {
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab: createActiveTab(),
    }));

    await act(async () => {
      result.current.handleCreateTab();
      result.current.handleCloseTab("tab-2");
      await Promise.resolve();
    });

    expect(workspaceNewTab).toHaveBeenCalledWith("window-1");
    expect(workspaceCloseTab).toHaveBeenCalledWith("window-1", "tab-2");
  });

  it("does nothing for window-scoped actions when no current window exists", async () => {
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: null,
      activeTab: createActiveTab(),
    }));

    await act(async () => {
      result.current.handleSetActiveTab("tab-2");
      result.current.handleCreateTab();
      result.current.handleCloseTab("tab-2");
      await Promise.resolve();
    });

    expect(workspaceSetActiveTab).not.toHaveBeenCalled();
    expect(workspaceNewTab).not.toHaveBeenCalled();
    expect(workspaceCloseTab).not.toHaveBeenCalled();
  });

  it("dispatches pane/layout state commands", async () => {
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab: createActiveTab(),
    }));

    await act(async () => {
      result.current.handleChangePanelType("tab-1", "pane-1", "Preview");
      result.current.handleSetPaneFilesystemState("tab-1", "pane-1", { currentPath: "C:\\" });
      result.current.handleSetSplitRatio("tab-1", "root.left", 0.35);
      result.current.handleSetTabSelectedFiles("tab-1", ["C:\\a.txt"]);
      await Promise.resolve();
    });

    expect(workspaceSetTabPanelType).toHaveBeenCalledWith("tab-1", "pane-1", "Preview");
    expect(workspaceSetTabPaneFilesystemState).toHaveBeenCalledWith("tab-1", "pane-1", { currentPath: "C:\\" });
    expect(workspaceSetTabLayoutSplitRatio).toHaveBeenCalledWith("tab-1", "root.left", 0.35);
    expect(workspaceSetTabSelectedFiles).toHaveBeenCalledWith("tab-1", ["C:\\a.txt"]);
  });

  it("skips pane/layout state commands when tab id is missing", async () => {
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab: createActiveTab(),
    }));

    await act(async () => {
      result.current.handleChangePanelType("", "pane-1", "Preview");
      result.current.handleSetPaneFilesystemState("", "pane-1", { currentPath: "C:\\" });
      result.current.handleSetSplitRatio("", "root.left", 0.35);
      result.current.handleSetTabSelectedFiles("", ["C:\\a.txt"]);
      await Promise.resolve();
    });

    expect(workspaceSetTabPanelType).not.toHaveBeenCalled();
    expect(workspaceSetTabPaneFilesystemState).not.toHaveBeenCalled();
    expect(workspaceSetTabLayoutSplitRatio).not.toHaveBeenCalled();
    expect(workspaceSetTabSelectedFiles).not.toHaveBeenCalled();
  });

  it("replaces current tab folder in place", async () => {
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab: createActiveTab(),
    }));

    await act(async () => {
      await result.current.handleOpenFolderInCurrentTab("tab-1", "C:\\Users");
    });

    expect(workspaceReplaceTabFolder).toHaveBeenCalledWith("tab-1", "C:\\Users");
  });

  it("ignores stale pane activation errors when pane no longer exists", async () => {
    workspaceSetTabActivePane.mockRejectedValueOnce(new Error("Pane not found."));
    const pushNotification = vi.fn();
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab: createActiveTab(),
      pushNotification,
    }));

    await act(async () => {
      result.current.handleSetActivePane("tab-1", "pane-stale");
      await Promise.resolve();
    });

    expect(workspaceSetTabActivePane).toHaveBeenCalledWith("tab-1", "pane-stale");
    expect(pushNotification).not.toHaveBeenCalled();
  });

  it("clears stored dirty state when pane reports no unsaved changes", async () => {
    const openConfirm = vi.fn().mockResolvedValue(true);
    const activeTab = createActiveTab({
      paneStates: {
        "pane-1": { panelType: "Preview" },
      },
    });
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab,
      openConfirm,
    }));

    act(() => {
      result.current.handlePaneDirtyStateChange("tab-1", "pane-1", {
        hasUnsavedChanges: true,
        message: "Draft changes",
      });
      result.current.handlePaneDirtyStateChange("tab-1", "pane-1", {
        hasUnsavedChanges: false,
      });
    });

    await act(async () => {
      await result.current.handleClosePane("tab-1", "pane-1");
    });

    expect(openConfirm).not.toHaveBeenCalled();
    expect(workspaceCloseTabPane).toHaveBeenCalledWith("tab-1", "pane-1");
  });

  it("stores empty dirty-state message when message is not a string", async () => {
    const openConfirm = vi.fn().mockResolvedValue(true);
    const activeTab = createActiveTab({
      paneStates: {
        "pane-1": { panelType: "Preview" },
      },
    });
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab,
      openConfirm,
    }));

    act(() => {
      result.current.handlePaneDirtyStateChange("tab-1", "pane-1", {
        hasUnsavedChanges: true,
        message: { value: "not-string" },
      });
    });

    await act(async () => {
      await result.current.handleClosePane("tab-1", "pane-1");
    });

    expect(openConfirm).toHaveBeenCalledWith(expect.objectContaining({
      message: "Close this pane and discard unsaved changes?",
    }));
  });

  it("skips split-active-pane and open-folder actions when required ids are missing", async () => {
    const { result: noTabResult } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab: null,
    }));
    const { result: noPaneResult } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab: createActiveTab({
        activePaneId: "",
        paneStates: {},
      }),
    }));

    await act(async () => {
      noTabResult.current.handleSplitActivePane("vertical");
      noPaneResult.current.handleSplitActivePane("horizontal");
      await noPaneResult.current.handleOpenFolderInCurrentTab("", "C:\\Users");
      await noPaneResult.current.handleOpenFolderInCurrentTab("tab-1", "");
      await Promise.resolve();
    });

    expect(workspaceSplitTabPane).not.toHaveBeenCalled();
    expect(workspaceReplaceTabFolder).not.toHaveBeenCalled();
  });
});

describe("useWorkspaceActions safety and error flows", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(null);
    resolvedCommands.forEach((commandMock) => {
      commandMock.mockReset();
      commandMock.mockResolvedValue(null);
    });
  });

  it("does not close pane when user rejects unsaved-changes confirmation", async () => {
    const openConfirm = vi.fn().mockResolvedValue(false);
    const activeTab = createActiveTab({
      paneStates: {
        "pane-1": { panelType: "Preview" },
      },
    });
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab,
      openConfirm,
    }));

    act(() => {
      result.current.handlePaneDirtyStateChange("tab-1", "pane-1", {
        hasUnsavedChanges: true,
        message: "Unsaved changes in preview.",
      });
    });

    await act(async () => {
      await result.current.handleClosePane("tab-1", "pane-1");
    });

    expect(openConfirm).toHaveBeenCalledTimes(1);
    expect(workspaceCloseTabPane).not.toHaveBeenCalled();
  });

  it("clears dirty pane state after confirmed close", async () => {
    const openConfirm = vi.fn().mockResolvedValue(true);
    const activeTab = createActiveTab({
      paneStates: {
        "pane-1": { panelType: "Preview" },
      },
    });
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab,
      openConfirm,
    }));

    act(() => {
      result.current.handlePaneDirtyStateChange("tab-1", "pane-1", {
        hasUnsavedChanges: true,
        message: "Unsaved changes in preview.",
      });
    });

    await act(async () => {
      await result.current.handleClosePane("tab-1", "pane-1");
      await result.current.handleClosePane("tab-1", "pane-1");
    });

    expect(openConfirm).toHaveBeenCalledTimes(1);
    expect(workspaceCloseTabPane).toHaveBeenCalledTimes(2);
    expect(workspaceCloseTabPane).toHaveBeenNthCalledWith(1, "tab-1", "pane-1");
    expect(workspaceCloseTabPane).toHaveBeenNthCalledWith(2, "tab-1", "pane-1");
  });

  it("shows notification for non-stale close-pane errors", async () => {
    workspaceCloseTabPane.mockRejectedValueOnce(new Error("Close failed."));
    const pushNotification = vi.fn();
    const activeTab = createActiveTab({
      paneStates: {
        "pane-1": { panelType: "Preview" },
      },
    });
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab,
      pushNotification,
    }));

    await act(async () => {
      await result.current.handleClosePane("tab-1", "pane-1");
      await Promise.resolve();
    });

    expect(workspaceCloseTabPane).toHaveBeenCalledWith("tab-1", "pane-1");
    expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Action failed",
      message: "Close failed.",
      tone: "error",
    }));
  });

  it("retries cwd command after failure by rolling back dedupe cache", async () => {
    workspaceSetTabTerminalCwd
      .mockRejectedValueOnce(new Error("CWD update failed."))
      .mockResolvedValueOnce(null);
    const pushNotification = vi.fn();
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab: createActiveTab(),
      pushNotification,
    }));

    await act(async () => {
      result.current.handleSetTabCwdHint("tab-1", "pane-1", "D:\\repo");
      await Promise.resolve();
    });

    await act(async () => {
      result.current.handleSetTabCwdHint("tab-1", "pane-1", "D:\\repo");
      await Promise.resolve();
    });

    expect(workspaceSetTabTerminalCwd).toHaveBeenCalledTimes(2);
    expect(workspaceSetTabTerminalCwd).toHaveBeenNthCalledWith(1, "tab-1", "D:\\repo");
    expect(workspaceSetTabTerminalCwd).toHaveBeenNthCalledWith(2, "tab-1", "D:\\repo");
    expect(pushNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: "Action failed",
      message: "CWD update failed.",
      tone: "error",
    }));
  });

  it("splits first available pane when active pane id is missing", async () => {
    const activeTab = createActiveTab({
      activePaneId: "",
      paneStates: {
        "pane-a": { panelType: "Filesystem" },
        "pane-b": { panelType: "Preview" },
      },
    });
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab,
    }));

    await act(async () => {
      result.current.handleSplitActivePane("vertical");
      await Promise.resolve();
    });

    expect(workspaceSplitTabPane).toHaveBeenCalledWith("tab-1", "pane-a", "vertical");
  });

  it("does not set active pane when it is already active", async () => {
    const activeTab = createActiveTab({
      activePaneId: "pane-1",
    });
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab,
    }));

    await act(async () => {
      result.current.handleSetActivePane("tab-1", "pane-1");
      await Promise.resolve();
    });

    expect(workspaceSetTabActivePane).not.toHaveBeenCalled();
  });

  it("runs a workspace script in a newly split terminal pane", async () => {
    workspaceSplitTabPane.mockResolvedValueOnce({
      newPaneId: "pane-2",
      snapshot: {
        tabs: [{
          tabId: "tab-1",
          paneStates: {
            "pane-2": {
              terminalSessionId: "term-2",
            },
          },
        }],
      },
    });
    const { result } = renderHook(() => useWorkspaceActions({
      currentWindow: { windowId: "window-1" },
      activeTab: createActiveTab(),
    }));

    let didRun = false;
    await act(async () => {
      didRun = await result.current.handleRunWorkspaceScript({
        tabId: "tab-1",
        paneId: "pane-1",
        scriptName: "dev",
        command: "npm run dev",
      });
    });

    expect(didRun).toBe(true);
    expect(workspaceSplitTabPane).toHaveBeenCalledWith("tab-1", "pane-1", "bottom", "Terminal");
    expect(invoke).toHaveBeenCalledWith("terminal_run_command", {
      sessionId: "term-2",
      command: "npm run dev",
    });
  });
});
