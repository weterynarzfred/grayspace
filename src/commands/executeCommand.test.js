import executeCommand from "./executeCommand";
import { COMMAND_IDS } from "./commandRegistry";

describe("executeCommand", () => {
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

  it("executes command-palette open callback", () => {
    const openCommandPalette = vi.fn();

    const didExecute = executeCommand(COMMAND_IDS.COMMAND_PALETTE_OPEN, {
      openCommandPalette,
    });

    expect(didExecute).toBe(true);
    expect(openCommandPalette).toHaveBeenCalledTimes(1);
  });
});
