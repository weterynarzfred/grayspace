import { uniqueNonEmptyPaths } from "../utils/pathSelection";

export const COMMAND_IDS = {
  COMMAND_PALETTE_OPEN: "commandPalette.open",
  PANE_SPLIT_VERTICAL: "pane.split.vertical",
  PANE_SPLIT_HORIZONTAL: "pane.split.horizontal",
  FILESYSTEM_DELETE_SELECTED: "filesystem.deleteSelected",
  FILESYSTEM_RENAME_SELECTED: "filesystem.renameSelected",
  TAB_CLOSE: "tab.close",
};

const NON_ENTRY_SELECTION_IDS = new Set(["__up__"]);
const CONTEXT_MENU_TARGETS = new Set(["file", "folder"]);

function getSelectedEntryPaths(context) {
  return uniqueNonEmptyPaths(context?.selectedPaths).filter(
    path => !NON_ENTRY_SELECTION_IDS.has(path),
  );
}

function hasActivePane(context) {
  return typeof context?.activePaneId === "string" && context.activePaneId.length > 0;
}

function isFilesystemPanelActive(context) {
  return context?.activePanelType === "Filesystem";
}

function isContextMenuSource(context) {
  return context?.source === "context-menu";
}

function isPanelContextTarget(context) {
  return context?.targetType === "panel";
}

function isFilesystemEntryContextTarget(context) {
  return CONTEXT_MENU_TARGETS.has(context?.targetType ?? "");
}

function isFilesystemTreeEntryContextTarget(context) {
  return isFilesystemEntryContextTarget(context) && context?.targetScope === "tree-entry";
}

function isFilesystemBrowsing(context) {
  return context?.isFilesystemBrowsing === true;
}

function isFilesystemCommandContext(context) {
  if (isContextMenuSource(context)) return isFilesystemTreeEntryContextTarget(context);
  return isFilesystemPanelActive(context) && isFilesystemBrowsing(context);
}

function hasSelectedEntries(context) {
  return getSelectedEntryPaths(context).length > 0;
}

function hasSingleRenameableSelection(context) {
  return getSelectedEntryPaths(context).length === 1;
}

export const COMMANDS = [
  {
    id: COMMAND_IDS.COMMAND_PALETTE_OPEN,
    title: "Open Command Palette",
    shortcut: "Ctrl+Shift+P",
    triggers: ["shortcut", "palette"],
    scope: "global",
    whenText: "true",
    when: () => true,
    shortcutMatcher: event =>
      event.ctrlKey
      && event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "p",
  },
  {
    id: COMMAND_IDS.PANE_SPLIT_VERTICAL,
    title: "Split Active Pane Vertically",
    shortcut: "Alt+V",
    triggers: ["shortcut", "palette", "context-menu"],
    scope: "pane",
    whenText: "(source !== \"context-menu\" && hasActivePane()) || targetType === \"panel\"",
    when: (context) => {
      if (!isContextMenuSource(context)) return hasActivePane(context);
      return isPanelContextTarget(context);
    },
    shortcutMatcher: event =>
      event.altKey
      && !event.ctrlKey
      && !event.shiftKey
      && !event.metaKey
      && event.key.toLowerCase() === "v",
  },
  {
    id: COMMAND_IDS.PANE_SPLIT_HORIZONTAL,
    title: "Split Active Pane Horizontally",
    shortcut: "Alt+H",
    triggers: ["shortcut", "palette", "context-menu"],
    scope: "pane",
    whenText: "(source !== \"context-menu\" && hasActivePane()) || targetType === \"panel\"",
    when: (context) => {
      if (!isContextMenuSource(context)) return hasActivePane(context);
      return isPanelContextTarget(context);
    },
    shortcutMatcher: event =>
      event.altKey
      && !event.ctrlKey
      && !event.shiftKey
      && !event.metaKey
      && event.key.toLowerCase() === "h",
  },
  {
    id: COMMAND_IDS.FILESYSTEM_DELETE_SELECTED,
    title: "Delete Selected Files/Folders",
    shortcut: "Delete",
    triggers: ["shortcut", "palette", "context-menu"],
    scope: "filesystem",
    whenText: "((activePanelType === \"Filesystem\" && isFilesystemBrowsing) || ((targetType === \"file\" || targetType === \"folder\") && targetScope === \"tree-entry\")) && hasSelectedEntries()",
    when: (context) => {
      if (!isFilesystemCommandContext(context)) return false;
      if (!hasSelectedEntries(context)) return false;
      if (!isContextMenuSource(context)) return true;
      return isFilesystemTreeEntryContextTarget(context);
    },
  },
  {
    id: COMMAND_IDS.FILESYSTEM_RENAME_SELECTED,
    title: "Rename Selected Entry",
    shortcut: "F2",
    triggers: ["shortcut", "palette", "context-menu"],
    scope: "filesystem",
    whenText: "((activePanelType === \"Filesystem\" && isFilesystemBrowsing) || ((targetType === \"file\" || targetType === \"folder\") && targetScope === \"tree-entry\")) && hasSingleRenameableSelection()",
    when: (context) => {
      if (!isFilesystemCommandContext(context)) return false;
      if (!hasSingleRenameableSelection(context)) return false;
      if (!isContextMenuSource(context)) return true;
      return isFilesystemTreeEntryContextTarget(context);
    },
    shortcutMatcher: event =>
      !event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key === "F2",
  },
  {
    id: COMMAND_IDS.TAB_CLOSE,
    title: "Close Tab",
    shortcut: "Middle Click Tab",
    triggers: ["shortcut", "context-menu"],
    scope: "tab",
    whenText: "source !== \"context-menu\" || targetType === \"tab\"",
    when: context => !isContextMenuSource(context) || context?.targetType === "tab",
  },
];

const COMMAND_BY_ID = Object.fromEntries(COMMANDS.map(command => [command.id, command]));

function matchesCommandTrigger(command, trigger) {
  return (command?.triggers ?? []).includes(trigger);
}

function matchesCommandContext(command, context = {}) {
  if (typeof command?.when !== "function") return true;
  return command.when(context);
}

export function isCommandShortcutMatch(commandId, event) {
  const command = COMMAND_BY_ID[commandId];
  if (!command?.shortcutMatcher) return false;
  return command.shortcutMatcher(event);
}

export function getCommandsForTrigger(trigger, context = {}) {
  const resolvedContext = { ...context, source: context.source ?? trigger };
  return COMMANDS.filter(command => (
    matchesCommandTrigger(command, trigger) && matchesCommandContext(command, resolvedContext)
  ));
}

export function formatCommandWhen(command) {
  return command?.whenText || "true";
}
