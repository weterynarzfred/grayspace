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

export default function executeCommand(
  commandId,
  {
    context = {},
    currentWindow = null,
    activeTab = null,
    workspaceActions = undefined,
    openCommandPalette = undefined,
  } = {},
) {
  if (!commandId) return false;

  if (commandId === COMMAND_IDS.COMMAND_PALETTE_OPEN) {
    openCommandPalette?.();
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

  if (commandId === COMMAND_IDS.PANE_SPLIT_VERTICAL || commandId === COMMAND_IDS.PANE_SPLIT_HORIZONTAL) {
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

  const targetPanelType = PANEL_TYPE_BY_COMMAND_ID[commandId];
  if (targetPanelType) {
    const tabId = activeTab?.tabId || "";
    const paneId = resolveTargetPaneId(context, activeTab);
    if (!tabId || !paneId) return false;

    workspaceActions?.handleChangePanelType?.(tabId, paneId, targetPanelType);
    return true;
  }

  if (commandId === COMMAND_IDS.TAB_CLOSE) {
    const tabId = resolveTargetTabId(context, activeTab);
    if (!tabId) return false;
    workspaceActions?.handleCloseTab?.(tabId);
    return true;
  }

  if (
    commandId === COMMAND_IDS.FILESYSTEM_UNDO
    || commandId === COMMAND_IDS.FILESYSTEM_REDO
    || commandId === COMMAND_IDS.FILESYSTEM_OPEN_SELECTED_FOLDER_IN_NEW_TAB
    || commandId === COMMAND_IDS.FILESYSTEM_GO_UP
    || commandId === COMMAND_IDS.FILESYSTEM_RENAME_SELECTED
    || commandId === COMMAND_IDS.FILESYSTEM_DELETE_SELECTED
  ) {
    dispatchAppCommand(commandId, context);
    return true;
  }

  return false;
}
