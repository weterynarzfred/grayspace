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

export default function executeCommand(
  commandId,
  {
    context = {},
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

  if (commandId === COMMAND_IDS.TAB_CLOSE) {
    const tabId = resolveTargetTabId(context, activeTab);
    if (!tabId) return false;
    workspaceActions?.handleCloseTab?.(tabId);
    return true;
  }

  if (
    commandId === COMMAND_IDS.FILESYSTEM_RENAME_SELECTED
    || commandId === COMMAND_IDS.FILESYSTEM_DELETE_SELECTED
  ) {
    dispatchAppCommand(commandId, context);
    return true;
  }

  return false;
}
