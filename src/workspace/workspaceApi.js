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

export function workspaceSetTabPanelType(tabId, pane, panelType) {
  return invoke("workspace_set_tab_panel_type", {
    payload: { tabId, pane, panelType },
  });
}

export function workspaceSetTabTerminalCwd(tabId, cwdHint) {
  return invoke("workspace_set_tab_terminal_cwd", {
    payload: { tabId, cwdHint },
  });
}

export function workspaceSetTabPaneFilesystemState(tabId, pane, filesystemState) {
  return invoke("workspace_set_tab_pane_filesystem_state", {
    payload: { tabId, pane, filesystemState },
  });
}

export function workspaceSetTabWorkspaceRoot(tabId, workspaceRoot) {
  return invoke("workspace_set_tab_workspace_root", {
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
