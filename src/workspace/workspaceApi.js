import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const WORKSPACE_UPDATED_EVENT = "workspace-updated";

export function workspaceBootstrap(windowLabel) {
  return invoke("workspace_bootstrap", { windowLabel });
}

export function workspaceGetSnapshot() {
  return invoke("workspace_get_snapshot");
}

export function workspaceNewWindow(options = null) {
  return invoke("workspace_new_window", { options });
}

export function workspaceNewTab(windowId) {
  return invoke("workspace_new_tab", { windowId });
}

export function workspaceSetActiveTab(windowId, tabId) {
  return invoke("workspace_set_active_tab", { windowId, tabId });
}

export function workspaceSetTabPanelType(tabId, paneId, panelType) {
  return invoke("workspace_set_tab_panel_type", {
    payload: { tabId, paneId, panelType },
  });
}

export function workspaceSetTabTerminalCwd(tabId, cwdHint) {
  return invoke("workspace_set_tab_terminal_cwd", {
    payload: { tabId, cwdHint },
  });
}

export function workspaceSetTabPaneFilesystemState(tabId, paneId, filesystemState) {
  return invoke("workspace_set_tab_pane_filesystem_state", {
    payload: { tabId, paneId, filesystemState },
  });
}

export function workspaceSetTabActivePane(tabId, paneId) {
  return invoke("workspace_set_tab_active_pane", {
    payload: { tabId, paneId },
  });
}

export function workspaceSplitTabPane(tabId, paneId, direction, newPanelType = null) {
  return invoke("workspace_split_tab_pane", {
    payload: {
      tabId,
      paneId,
      direction,
      newPanelType,
    },
  });
}

export function workspaceCloseTabPane(tabId, paneId) {
  return invoke("workspace_close_tab_pane", {
    payload: { tabId, paneId },
  });
}

export function workspaceSetTabLayoutSplitRatio(tabId, splitPath, ratio) {
  return invoke("workspace_set_tab_layout_split_ratio", {
    payload: { tabId, splitPath, ratio },
  });
}

export function workspaceSetTabSelectedFiles(tabId, selectedFiles) {
  return invoke("workspace_set_tab_selected_files", {
    payload: { tabId, selectedFiles },
  });
}

export function workspaceSetTabWorkspaceRoot(tabId, workspaceRoot) {
  return invoke("workspace_set_tab_workspace_root", {
    payload: { tabId, workspaceRoot },
  });
}

export function workspaceOpenWorkspaceFolderFromTab(tabId, workspaceRoot) {
  return invoke("workspace_open_workspace_folder_from_tab", {
    payload: { tabId, workspaceRoot },
  });
}

export function workspaceMoveTab(sourceWindowId, targetWindowId, tabId, targetIndex = null) {
  return invoke("workspace_move_tab", {
    payload: { sourceWindowId, targetWindowId, tabId, targetIndex },
  });
}

export function workspaceDetachTabToNewWindow(sourceWindowId, tabId, x = null, y = null) {
  return invoke("workspace_detach_tab_to_new_window", {
    payload: { sourceWindowId, tabId, x, y },
  });
}

export function workspaceCloseTab(windowId, tabId) {
  return invoke("workspace_close_tab", { payload: { windowId, tabId } });
}

export function workspaceCloseWindow(windowId) {
  return invoke("workspace_close_window", { windowId });
}

export function workspaceSetWindowBounds(windowId, bounds) {
  return invoke("workspace_set_window_bounds", { windowId, bounds });
}

export function listenWorkspaceUpdated(handler) {
  return listen(WORKSPACE_UPDATED_EVENT, event => {
    handler(event.payload?.snapshot ?? null);
  });
}
