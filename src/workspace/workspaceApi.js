import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const WORKSPACE_UPDATED_EVENT = "workspace-updated";
const invokeWithPayload = (command, payload) => invoke(command, { payload });

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
  return invokeWithPayload("workspace_set_tab_panel_type", { tabId, paneId, panelType });
}

export function workspaceSetTabTerminalCwd(tabId, cwdHint) {
  return invokeWithPayload("workspace_set_tab_terminal_cwd", { tabId, cwdHint });
}

export function workspaceSetTabPaneFilesystemState(tabId, paneId, filesystemState) {
  return invokeWithPayload("workspace_set_tab_pane_filesystem_state", {
    tabId,
    paneId,
    filesystemState,
  });
}

export function workspaceSetTabActivePane(tabId, paneId) {
  return invokeWithPayload("workspace_set_tab_active_pane", { tabId, paneId });
}

export function workspaceSplitTabPane(tabId, paneId, direction, newPanelType = null) {
  return invokeWithPayload("workspace_split_tab_pane", {
    tabId,
    paneId,
    direction,
    newPanelType,
  });
}

export function workspaceCloseTabPane(tabId, paneId) {
  return invokeWithPayload("workspace_close_tab_pane", { tabId, paneId });
}

export function workspaceSetTabLayoutSplitRatio(tabId, splitPath, ratio) {
  return invokeWithPayload("workspace_set_tab_layout_split_ratio", { tabId, splitPath, ratio });
}

export function workspaceSetTabSelectedFiles(tabId, selectedFiles) {
  return invokeWithPayload("workspace_set_tab_selected_files", { tabId, selectedFiles });
}

export function workspaceSetTabWorkspaceRoot(tabId, workspaceRoot) {
  return invokeWithPayload("workspace_set_tab_workspace_root", { tabId, workspaceRoot });
}

export function workspaceOpenWorkspaceFolderFromTab(tabId, workspaceRoot) {
  return invokeWithPayload("workspace_open_workspace_folder_from_tab", { tabId, workspaceRoot });
}

export function workspaceOpenFolderFromTab(tabId, path) {
  return invokeWithPayload("workspace_open_folder_from_tab", { tabId, path });
}

export function workspaceMoveTab(sourceWindowId, targetWindowId, tabId, targetIndex = null) {
  return invokeWithPayload("workspace_move_tab", {
    sourceWindowId,
    targetWindowId,
    tabId,
    targetIndex,
  });
}

export function workspaceDetachTabToNewWindow(sourceWindowId, tabId, x = null, y = null) {
  return invokeWithPayload("workspace_detach_tab_to_new_window", { sourceWindowId, tabId, x, y });
}

export function workspaceCloseTab(windowId, tabId) {
  return invokeWithPayload("workspace_close_tab", { windowId, tabId });
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
