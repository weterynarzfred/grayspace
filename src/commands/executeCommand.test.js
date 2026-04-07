import executeCommand from "./executeCommand";
import { COMMAND_IDS } from "./commandRegistry";

describe("executeCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("executes split commands through workspace actions", () => {
    const handleSplitPane = vi.fn();

    const didExecute = executeCommand(COMMAND_IDS.PANE_SPLIT_VERTICAL, {
      activeTab: { tabId: "tab-1", activePaneId: "pane-1" },
      workspaceActions: { handleSplitPane },
    });

    expect(didExecute).toBe(true);
    expect(handleSplitPane).toHaveBeenCalledWith("tab-1", "pane-1", "right");
  });

  it("uses panel target from context when present", () => {
    const handleSplitPane = vi.fn();

    executeCommand(COMMAND_IDS.PANE_SPLIT_HORIZONTAL, {
      context: { targetType: "panel", targetId: "pane-target" },
      activeTab: { tabId: "tab-1", activePaneId: "pane-1" },
      workspaceActions: { handleSplitPane },
    });

    expect(handleSplitPane).toHaveBeenCalledWith("tab-1", "pane-target", "bottom");
  });

  it("executes tab close with resolved tab id", () => {
    const handleCloseTab = vi.fn();

    executeCommand(COMMAND_IDS.TAB_CLOSE, {
      context: { targetType: "tab", targetId: "tab-target" },
      activeTab: { tabId: "tab-1" },
      workspaceActions: { handleCloseTab },
    });

    expect(handleCloseTab).toHaveBeenCalledWith("tab-target");
  });

  it("creates tabs and windows through workspace actions", () => {
    const handleCreateTab = vi.fn();
    const handleCreateWindow = vi.fn();

    expect(executeCommand(COMMAND_IDS.TAB_NEW, {
      workspaceActions: { handleCreateTab },
    })).toBe(true);
    expect(executeCommand(COMMAND_IDS.WINDOW_NEW, {
      workspaceActions: { handleCreateWindow },
    })).toBe(true);

    expect(handleCreateTab).toHaveBeenCalledTimes(1);
    expect(handleCreateWindow).toHaveBeenCalledTimes(1);
  });

  it("switches to the next tab in the current window order", () => {
    const handleSetActiveTab = vi.fn();

    const didExecute = executeCommand(COMMAND_IDS.TAB_SWITCH_NEXT, {
      currentWindow: {
        activeTabId: "tab-2",
        tabOrder: ["tab-1", "tab-2", "tab-3"],
      },
      activeTab: { tabId: "tab-2" },
      workspaceActions: { handleSetActiveTab },
    });

    expect(didExecute).toBe(true);
    expect(handleSetActiveTab).toHaveBeenCalledWith("tab-3");
  });

  it("wraps when switching to the next tab from the last tab", () => {
    const handleSetActiveTab = vi.fn();

    executeCommand(COMMAND_IDS.TAB_SWITCH_NEXT, {
      currentWindow: {
        activeTabId: "tab-3",
        tabOrder: ["tab-1", "tab-2", "tab-3"],
      },
      activeTab: { tabId: "tab-3" },
      workspaceActions: { handleSetActiveTab },
    });

    expect(handleSetActiveTab).toHaveBeenCalledWith("tab-1");
  });

  it("switches active pane panel type", () => {
    const handleChangePanelType = vi.fn();

    const didExecute = executeCommand(COMMAND_IDS.PANE_SWITCH_TO_EXTERNAL_UI, {
      activeTab: { tabId: "tab-1", activePaneId: "pane-1" },
      workspaceActions: { handleChangePanelType },
    });

    expect(didExecute).toBe(true);
    expect(handleChangePanelType).toHaveBeenCalledWith("tab-1", "pane-1", "External UI");
  });

  it("dispatches filesystem app commands", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const context = { source: "palette", activePaneId: "pane-1" };

    const didExecute = executeCommand(COMMAND_IDS.FILESYSTEM_RENAME_SELECTED, { context });

    expect(didExecute).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    const [event] = dispatchSpy.mock.calls[0];
    expect(event.type).toBe("grayspace-command");
    expect(event.detail).toEqual({
      commandId: COMMAND_IDS.FILESYSTEM_RENAME_SELECTED,
      context,
    });
  });

  it("dispatches filesystem undo command events", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const context = { source: "shortcut", activePaneId: "pane-1" };

    const didExecute = executeCommand(COMMAND_IDS.FILESYSTEM_UNDO, { context });

    expect(didExecute).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    const [event] = dispatchSpy.mock.calls[0];
    expect(event.type).toBe("grayspace-command");
    expect(event.detail).toEqual({
      commandId: COMMAND_IDS.FILESYSTEM_UNDO,
      context,
    });
  });

  it("dispatches filesystem create command events", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const context = { source: "shortcut", activePaneId: "pane-1" };

    const didExecute = executeCommand(COMMAND_IDS.FILESYSTEM_CREATE_TEXT_FILE, { context });

    expect(didExecute).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    const [event] = dispatchSpy.mock.calls[0];
    expect(event.type).toBe("grayspace-command");
    expect(event.detail).toEqual({
      commandId: COMMAND_IDS.FILESYSTEM_CREATE_TEXT_FILE,
      context,
    });
  });

  it("dispatches filesystem clipboard command events", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const context = { source: "context-menu", targetPaneId: "pane-1" };

    const didExecute = executeCommand(COMMAND_IDS.FILESYSTEM_PASTE, { context });

    expect(didExecute).toBe(true);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    const [event] = dispatchSpy.mock.calls[0];
    expect(event.type).toBe("grayspace-command");
    expect(event.detail).toEqual({
      commandId: COMMAND_IDS.FILESYSTEM_PASTE,
      context,
    });
  });

  it("executes command-palette open callback", () => {
    const openCommandPalette = vi.fn();

    const didExecute = executeCommand(COMMAND_IDS.COMMAND_PALETTE_OPEN, {
      openCommandPalette,
    });

    expect(didExecute).toBe(true);
    expect(openCommandPalette).toHaveBeenCalledTimes(1);
  });

  it("executes open-recent-folders callback", () => {
    const openRecentFolders = vi.fn();

    const didExecute = executeCommand(COMMAND_IDS.FILESYSTEM_OPEN_RECENT_FOLDERS, {
      openRecentFolders,
    });

    expect(didExecute).toBe(true);
    expect(openRecentFolders).toHaveBeenCalledTimes(1);
  });
});
