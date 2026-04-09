import { dispatchAppCommand } from "./commandEvents";
import { COMMAND_IDS } from "./commandRegistry";

function resolveTargetPaneId(context = {}, activeTab = null) {
  if (context?.targetType === "panel" && context.targetId) return context.targetId;
  return activeTab?.activePaneId || "";
}

function resolveTargetTabId(context = {}, activeTab = null) {
  if (context?.targetType === "tab" && context.targetId) return context.targetId;
  return activeTab?.tabId || "";
}

const PANEL_TYPE_BY_COMMAND_ID = {
  [COMMAND_IDS.PANE_SWITCH_TO_FILESYSTEM]: "Filesystem",
  [COMMAND_IDS.PANE_SWITCH_TO_TERMINAL]: "Terminal",
  [COMMAND_IDS.PANE_SWITCH_TO_PREVIEW]: "Preview",
  [COMMAND_IDS.PANE_SWITCH_TO_PROPERTIES]: "Properties",
  [COMMAND_IDS.PANE_SWITCH_TO_EXTERNAL_UI]: "External UI",
};

const DISPATCHED_FILESYSTEM_COMMANDS = new Set([
  COMMAND_IDS.FILESYSTEM_UNDO,
  COMMAND_IDS.FILESYSTEM_REDO,
  COMMAND_IDS.FILESYSTEM_OPEN_SELECTED_FOLDER_IN_NEW_TAB,
  COMMAND_IDS.FILESYSTEM_GO_UP,
  COMMAND_IDS.FILESYSTEM_RENAME_SELECTED,
  COMMAND_IDS.FILESYSTEM_COPY,
  COMMAND_IDS.FILESYSTEM_CUT,
  COMMAND_IDS.FILESYSTEM_PASTE,
  COMMAND_IDS.FILESYSTEM_FOCUS_BREADCRUMB_INPUT,
  COMMAND_IDS.FILESYSTEM_CREATE_TEXT_FILE,
  COMMAND_IDS.FILESYSTEM_CREATE_FOLDER,
  COMMAND_IDS.FILESYSTEM_DELETE_SELECTED,
]);

function executeTabSwitchNext(currentWindow, activeTab, workspaceActions) {
  const tabOrder = Array.isArray(currentWindow?.tabOrder) ? currentWindow.tabOrder : [];
  if (tabOrder.length === 0) return false;

  const activeTabId = activeTab?.tabId || currentWindow?.activeTabId || "";
  const activeTabIndex = tabOrder.indexOf(activeTabId);
  const nextTabIndex = activeTabIndex < 0 ? 0 : (activeTabIndex + 1) % tabOrder.length;
  const nextTabId = tabOrder[nextTabIndex];
  if (!nextTabId) return false;

  workspaceActions?.handleSetActiveTab?.(nextTabId);
  return true;
}

function executePaneSplit(commandId, context, activeTab, workspaceActions) {
  const tabId = activeTab?.tabId || "";
  const paneId = resolveTargetPaneId(context, activeTab);
  if (!tabId || !paneId) return false;

  workspaceActions?.handleSplitPane?.(
    tabId,
    paneId,
    commandId === COMMAND_IDS.PANE_SPLIT_VERTICAL ? "right" : "bottom",
  );
  return true;
}

function executePanelTypeSwitch(commandId, context, activeTab, workspaceActions) {
  const targetPanelType = PANEL_TYPE_BY_COMMAND_ID[commandId];
  if (!targetPanelType) return false;

  const tabId = activeTab?.tabId || "";
  const paneId = resolveTargetPaneId(context, activeTab);
  if (!tabId || !paneId) return false;

  workspaceActions?.handleChangePanelType?.(tabId, paneId, targetPanelType);
  return true;
}

export default function executeCommand(
  commandId,
  {
    context = {},
    currentWindow = null,
    activeTab = null,
    workspaceActions = undefined,
    openCommandPalette = undefined,
    openRecentFolders = undefined,
  } = {},
) {
  if (!commandId) return false;

  if (commandId === COMMAND_IDS.COMMAND_PALETTE_OPEN) {
    openCommandPalette?.();
    return true;
  }

  if (commandId === COMMAND_IDS.FILESYSTEM_OPEN_RECENT_FOLDERS) {
    openRecentFolders?.();
    return true;
  }

  if (commandId === COMMAND_IDS.TAB_NEW) {
    workspaceActions?.handleCreateTab?.();
    return true;
  }

  if (commandId === COMMAND_IDS.WINDOW_NEW) {
    workspaceActions?.handleCreateWindow?.();
    return true;
  }

  if (commandId === COMMAND_IDS.TAB_SWITCH_NEXT) {
    return executeTabSwitchNext(currentWindow, activeTab, workspaceActions);
  }

  if (commandId === COMMAND_IDS.PANE_SPLIT_VERTICAL || commandId === COMMAND_IDS.PANE_SPLIT_HORIZONTAL) {
    return executePaneSplit(commandId, context, activeTab, workspaceActions);
  }

  if (PANEL_TYPE_BY_COMMAND_ID[commandId]) {
    return executePanelTypeSwitch(commandId, context, activeTab, workspaceActions);
  }

  if (commandId === COMMAND_IDS.TAB_CLOSE) {
    const tabId = resolveTargetTabId(context, activeTab);
    if (!tabId) return false;
    workspaceActions?.handleCloseTab?.(tabId);
    return true;
  }

  if (DISPATCHED_FILESYSTEM_COMMANDS.has(commandId)) {
    dispatchAppCommand(commandId, context);
    return true;
  }

  return false;
}
