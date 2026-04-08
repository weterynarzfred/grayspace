import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  WORKSPACE_UPDATED_EVENT,
  listenWorkspaceUpdated,
  workspaceBootstrap,
  workspaceCloseTab,
  workspaceCloseTabPane,
  workspaceCloseWindow,
  workspaceDetachTabToNewWindow,
  workspaceGetSnapshot,
  workspaceMoveTab,
  workspaceNewTab,
  workspaceNewWindow,
  workspaceOpenFolderFromTab,
  workspaceOpenWorkspaceFolderFromTab,
  workspaceRecentFoldersList,
  workspaceRecentFoldersRecord,
  workspaceRecentFoldersRemove,
  workspaceReplaceTabFolder,
  workspaceSetActiveTab,
  workspaceSetTabActivePane,
  workspaceSetTabLayoutSplitRatio,
  workspaceSetTabPanelType,
  workspaceSetTabPaneFilesystemState,
  workspaceSetTabSelectedFiles,
  workspaceSetTabTerminalCwd,
  workspaceSetTabWorkspaceRoot,
  workspaceSetWindowBounds,
  workspaceSplitTabPane,
} from "./workspaceApi";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("workspaceApi command contracts", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    invoke.mockResolvedValue(null);
    listen.mockResolvedValue(() => {});
  });

  it.each([
    ["workspaceBootstrap", () => workspaceBootstrap("main"), "workspace_bootstrap", { windowLabel: "main" }],
    ["workspaceGetSnapshot", () => workspaceGetSnapshot(), "workspace_get_snapshot"],
    ["workspaceNewWindow", () => workspaceNewWindow(), "workspace_new_window", { options: null }],
    ["workspaceNewTab", () => workspaceNewTab("window-1"), "workspace_new_tab", { windowId: "window-1" }],
    [
      "workspaceSetActiveTab",
      () => workspaceSetActiveTab("window-1", "tab-1"),
      "workspace_set_active_tab",
      { windowId: "window-1", tabId: "tab-1" },
    ],
    ["workspaceRecentFoldersList", () => workspaceRecentFoldersList(), "workspace_recent_folders_list"],
    [
      "workspaceRecentFoldersRecord",
      () => workspaceRecentFoldersRecord("C:\\workspace"),
      "workspace_recent_folders_record",
      { path: "C:\\workspace" },
    ],
    [
      "workspaceRecentFoldersRemove",
      () => workspaceRecentFoldersRemove("C:\\workspace"),
      "workspace_recent_folders_remove",
      { path: "C:\\workspace" },
    ],
    [
      "workspaceCloseWindow",
      () => workspaceCloseWindow("window-1"),
      "workspace_close_window",
      { windowId: "window-1" },
    ],
    [
      "workspaceSetWindowBounds",
      () => workspaceSetWindowBounds("window-1", { x: 20, y: 30 }),
      "workspace_set_window_bounds",
      { windowId: "window-1", bounds: { x: 20, y: 30 } },
    ],
  ])("%s invokes correct command and args", async (_label, run, expectedCommand, expectedArgs) => {
    await run();
    if (expectedArgs) {
      expect(invoke).toHaveBeenCalledWith(expectedCommand, expectedArgs);
    } else {
      expect(invoke).toHaveBeenCalledWith(expectedCommand);
    }
  });

  it.each([
    [
      "workspaceSetTabPanelType",
      () => workspaceSetTabPanelType("tab-1", "pane-1", "Filesystem"),
      "workspace_set_tab_panel_type",
      { tabId: "tab-1", paneId: "pane-1", panelType: "Filesystem" },
    ],
    [
      "workspaceSetTabTerminalCwd",
      () => workspaceSetTabTerminalCwd("tab-1", "C:\\workspace"),
      "workspace_set_tab_terminal_cwd",
      { tabId: "tab-1", cwdHint: "C:\\workspace" },
    ],
    [
      "workspaceSetTabPaneFilesystemState",
      () => workspaceSetTabPaneFilesystemState("tab-1", "pane-1", { currentPath: "C:\\" }),
      "workspace_set_tab_pane_filesystem_state",
      { tabId: "tab-1", paneId: "pane-1", filesystemState: { currentPath: "C:\\" } },
    ],
    [
      "workspaceSetTabActivePane",
      () => workspaceSetTabActivePane("tab-1", "pane-2"),
      "workspace_set_tab_active_pane",
      { tabId: "tab-1", paneId: "pane-2" },
    ],
    [
      "workspaceSplitTabPane",
      () => workspaceSplitTabPane("tab-1", "pane-1", "vertical"),
      "workspace_split_tab_pane",
      { tabId: "tab-1", paneId: "pane-1", direction: "vertical", newPanelType: null },
    ],
    [
      "workspaceCloseTabPane",
      () => workspaceCloseTabPane("tab-1", "pane-1"),
      "workspace_close_tab_pane",
      { tabId: "tab-1", paneId: "pane-1" },
    ],
    [
      "workspaceSetTabLayoutSplitRatio",
      () => workspaceSetTabLayoutSplitRatio("tab-1", "root.left", 0.4),
      "workspace_set_tab_layout_split_ratio",
      { tabId: "tab-1", splitPath: "root.left", ratio: 0.4 },
    ],
    [
      "workspaceSetTabSelectedFiles",
      () => workspaceSetTabSelectedFiles("tab-1", ["C:\\a.txt"]),
      "workspace_set_tab_selected_files",
      { tabId: "tab-1", selectedFiles: ["C:\\a.txt"] },
    ],
    [
      "workspaceSetTabWorkspaceRoot",
      () => workspaceSetTabWorkspaceRoot("tab-1", "C:\\workspace"),
      "workspace_set_tab_workspace_root",
      { tabId: "tab-1", workspaceRoot: "C:\\workspace" },
    ],
    [
      "workspaceOpenWorkspaceFolderFromTab",
      () => workspaceOpenWorkspaceFolderFromTab("tab-1", "C:\\workspace"),
      "workspace_open_workspace_folder_from_tab",
      { tabId: "tab-1", workspaceRoot: "C:\\workspace" },
    ],
    [
      "workspaceOpenFolderFromTab",
      () => workspaceOpenFolderFromTab("tab-1", "D:\\notes"),
      "workspace_open_folder_from_tab",
      { tabId: "tab-1", path: "D:\\notes" },
    ],
    [
      "workspaceReplaceTabFolder",
      () => workspaceReplaceTabFolder("tab-1", "D:\\notes"),
      "workspace_replace_tab_folder",
      { tabId: "tab-1", path: "D:\\notes" },
    ],
    [
      "workspaceMoveTab",
      () => workspaceMoveTab("window-a", "window-b", "tab-1"),
      "workspace_move_tab",
      {
        sourceWindowId: "window-a",
        targetWindowId: "window-b",
        tabId: "tab-1",
        targetIndex: null,
      },
    ],
    [
      "workspaceDetachTabToNewWindow",
      () => workspaceDetachTabToNewWindow("window-a", "tab-1"),
      "workspace_detach_tab_to_new_window",
      { sourceWindowId: "window-a", tabId: "tab-1", x: null, y: null },
    ],
    [
      "workspaceCloseTab",
      () => workspaceCloseTab("window-a", "tab-1"),
      "workspace_close_tab",
      { windowId: "window-a", tabId: "tab-1" },
    ],
  ])("%s wraps payload correctly", async (_label, run, expectedCommand, expectedPayload) => {
    await run();
    expect(invoke).toHaveBeenCalledWith(expectedCommand, { payload: expectedPayload });
  });

  it("maps workspace-updated events to snapshot payload", async () => {
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);
    const handler = vi.fn();

    const returned = await listenWorkspaceUpdated(handler);
    expect(returned).toBe(unlisten);
    expect(listen).toHaveBeenCalledWith(WORKSPACE_UPDATED_EVENT, expect.any(Function));

    const eventHandler = listen.mock.calls[0][1];
    eventHandler({ payload: { snapshot: { windows: [] } } });
    eventHandler({ payload: {} });

    expect(handler).toHaveBeenNthCalledWith(1, { windows: [] });
    expect(handler).toHaveBeenNthCalledWith(2, null);
  });
});
