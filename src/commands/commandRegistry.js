import { uniqueNonEmptyPaths } from "../utils/pathSelection";

export const COMMAND_IDS = {
  COMMAND_PALETTE_OPEN: "commandPalette.open",
  TAB_NEW: "tab.new",
  WINDOW_NEW: "window.new",
  TAB_CLOSE: "tab.close",
  TAB_SWITCH_NEXT: "tab.switch.next",
  PANE_SPLIT_VERTICAL: "pane.split.vertical",
  PANE_SPLIT_HORIZONTAL: "pane.split.horizontal",
  PANE_SWITCH_TO_FILESYSTEM: "pane.switch.filesystem",
  PANE_SWITCH_TO_TERMINAL: "pane.switch.terminal",
  PANE_SWITCH_TO_PREVIEW: "pane.switch.preview",
  PANE_SWITCH_TO_PROPERTIES: "pane.switch.properties",
  PANE_SWITCH_TO_EXTERNAL_UI: "pane.switch.externalUi",
  PANE_TOGGLE_MAXIMIZE: "pane.toggleMaximize",
  FILESYSTEM_UNDO: "filesystem.undo",
  FILESYSTEM_REDO: "filesystem.redo",
  FILESYSTEM_OPEN_SELECTED_FOLDER_IN_NEW_TAB: "filesystem.openSelectedFolderInNewTab",
  FILESYSTEM_GO_UP: "filesystem.goUp",
  FILESYSTEM_DELETE_SELECTED: "filesystem.deleteSelected",
  FILESYSTEM_RENAME_SELECTED: "filesystem.renameSelected",
  FILESYSTEM_BULK_RENAME: "filesystem.bulkRename",
  FILESYSTEM_COPY: "filesystem.copy",
  FILESYSTEM_CUT: "filesystem.cut",
  FILESYSTEM_PASTE: "filesystem.paste",
  FILESYSTEM_FILTER_CURRENT_FOLDER: "filesystem.filterCurrentFolder",
  FILESYSTEM_SEARCH_CURRENT_SUBTREE: "filesystem.searchCurrentSubtree",
  FILESYSTEM_OPEN_RECENT_FOLDERS: "filesystem.openRecentFolders",
  FILESYSTEM_CREATE_TEXT_FILE: "filesystem.createTextFile",
  FILESYSTEM_CREATE_FOLDER: "filesystem.createFolder",
  WORKSPACE_RUN_SCRIPT: "workspace.runScript",
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

function hasActiveTab(context) {
  return typeof context?.activeTabId === "string" && context.activeTabId.length > 0;
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

function isFilesystemPanelContextTarget(context) {
  return isPanelContextTarget(context) && context?.targetPanelType === "Filesystem";
}

function isFilesystemEntryContextTarget(context) {
  return CONTEXT_MENU_TARGETS.has(context?.targetType ?? "");
}

function isFilesystemTreeEntryContextTarget(context) {
  return isFilesystemEntryContextTarget(context) && context?.targetScope === "tree-entry";
}

function isFilesystemTreeFolderContextTarget(context) {
  return context?.targetType === "folder" && context?.targetScope === "tree-entry";
}

function isFilesystemPasteContextTarget(context) {
  return isFilesystemTreeFolderContextTarget(context) || isFilesystemPanelContextTarget(context);
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

function hasSingleDirectorySelection(context) {
  const selectedEntryPaths = getSelectedEntryPaths(context);
  if (selectedEntryPaths.length !== 1) return false;

  const selectedPath = selectedEntryPaths[0];
  const selectedEntryKinds = context?.selectedEntryKinds;
  if (!selectedEntryKinds || typeof selectedEntryKinds !== "object") return true;
  return selectedEntryKinds[selectedPath] === "folder";
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
    id: COMMAND_IDS.TAB_NEW,
    title: "New Tab",
    shortcut: "Ctrl+T",
    triggers: ["shortcut", "palette"],
    scope: "tab",
    whenText: "hasActiveTab()",
    when: hasActiveTab,
    shortcutMatcher: event =>
      event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "t",
  },
  {
    id: COMMAND_IDS.WINDOW_NEW,
    title: "New Window",
    shortcut: "Ctrl+N",
    triggers: ["shortcut", "palette"],
    scope: "window",
    whenText: "true",
    when: () => true,
    shortcutMatcher: event =>
      event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "n",
  },
  {
    id: COMMAND_IDS.TAB_CLOSE,
    title: "Close Tab",
    shortcut: "Ctrl+F4 / Middle Click Tab",
    triggers: ["shortcut", "palette", "context-menu"],
    scope: "tab",
    whenText: "source !== \"context-menu\" || targetType === \"tab\"",
    when: context => !isContextMenuSource(context) || context?.targetType === "tab",
    shortcutMatcher: event =>
      event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key === "F4",
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
    id: COMMAND_IDS.PANE_SWITCH_TO_FILESYSTEM,
    title: "Switch Active Pane to Filesystem",
    shortcut: "Ctrl+Shift+E",
    triggers: ["shortcut", "palette"],
    scope: "pane",
    whenText: "hasActivePane()",
    when: hasActivePane,
    shortcutMatcher: event =>
      event.ctrlKey
      && event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "e",
  },
  {
    id: COMMAND_IDS.PANE_SWITCH_TO_TERMINAL,
    title: "Switch Active Pane to Terminal",
    shortcut: "Ctrl+Shift+`",
    triggers: ["shortcut", "palette"],
    scope: "pane",
    whenText: "hasActivePane()",
    when: hasActivePane,
    shortcutMatcher: event =>
      event.ctrlKey
      && event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.code === "Backquote",
  },
  {
    id: COMMAND_IDS.PANE_SWITCH_TO_PREVIEW,
    title: "Switch Active Pane to Preview",
    shortcut: "Ctrl+Shift+V",
    triggers: ["shortcut", "palette"],
    scope: "pane",
    whenText: "hasActivePane()",
    when: hasActivePane,
    shortcutMatcher: event =>
      event.ctrlKey
      && event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "v",
  },
  {
    id: COMMAND_IDS.PANE_SWITCH_TO_PROPERTIES,
    title: "Switch Active Pane to Properties",
    shortcut: "Ctrl+Shift+O",
    triggers: ["shortcut", "palette"],
    scope: "pane",
    whenText: "hasActivePane()",
    when: hasActivePane,
    shortcutMatcher: event =>
      event.ctrlKey
      && event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "o",
  },
  {
    id: COMMAND_IDS.PANE_SWITCH_TO_EXTERNAL_UI,
    title: "Switch Active Pane to External UI",
    shortcut: "Ctrl+Shift+U",
    triggers: ["shortcut", "palette"],
    scope: "pane",
    whenText: "hasActivePane()",
    when: hasActivePane,
    shortcutMatcher: event =>
      event.ctrlKey
      && event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "u",
  },
  {
    id: COMMAND_IDS.FILESYSTEM_UNDO,
    title: "Undo Filesystem Action",
    shortcut: "Ctrl+Z",
    triggers: ["shortcut", "palette"],
    scope: "filesystem",
    whenText: "activePanelType === \"Filesystem\" && isFilesystemBrowsing",
    when: context => isFilesystemPanelActive(context) && isFilesystemBrowsing(context),
    shortcutMatcher: event =>
      event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "z",
  },
  {
    id: COMMAND_IDS.FILESYSTEM_REDO,
    title: "Redo Filesystem Action",
    shortcut: "Ctrl+Y",
    triggers: ["shortcut", "palette"],
    scope: "filesystem",
    whenText: "activePanelType === \"Filesystem\" && isFilesystemBrowsing",
    when: context => isFilesystemPanelActive(context) && isFilesystemBrowsing(context),
    shortcutMatcher: event =>
      event.ctrlKey
      && !event.altKey
      && !event.metaKey
      && (
        (!event.shiftKey && event.key.toLowerCase() === "y")
        || (event.shiftKey && event.key.toLowerCase() === "z")
      ),
  },
  {
    id: COMMAND_IDS.FILESYSTEM_OPEN_SELECTED_FOLDER_IN_NEW_TAB,
    title: "Open Selected Folder in New Tab",
    shortcut: "Ctrl+Enter",
    triggers: ["shortcut", "palette", "context-menu"],
    scope: "filesystem",
    whenText: "source === \"context-menu\" ? (targetType === \"folder\" && targetScope === \"tree-entry\") : (activePanelType === \"Filesystem\" && isFilesystemBrowsing && hasSingleDirectorySelection())",
    when: (context) => {
      if (isContextMenuSource(context)) return (
        context?.targetType === "folder"
        && context?.targetScope === "tree-entry"
      );
      return (
        isFilesystemPanelActive(context)
        && isFilesystemBrowsing(context)
        && hasSingleDirectorySelection(context)
      );
    },
    shortcutMatcher: event =>
      event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key === "Enter",
  },
  {
    id: COMMAND_IDS.FILESYSTEM_GO_UP,
    title: "Go One Folder Up",
    shortcut: "Alt+ArrowUp",
    triggers: ["shortcut", "palette"],
    scope: "filesystem",
    whenText: "activePanelType === \"Filesystem\" && isFilesystemBrowsing",
    when: context => isFilesystemPanelActive(context) && isFilesystemBrowsing(context),
    shortcutMatcher: event =>
      event.altKey
      && !event.ctrlKey
      && !event.shiftKey
      && !event.metaKey
      && event.key === "ArrowUp",
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
    id: COMMAND_IDS.TAB_SWITCH_NEXT,
    title: "Switch to Next Tab",
    shortcut: "Ctrl+Tab",
    triggers: ["shortcut", "palette"],
    scope: "tab",
    whenText: "hasActiveTab()",
    when: hasActiveTab,
    shortcutMatcher: event =>
      event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key === "Tab",
  },
  {
    id: COMMAND_IDS.FILESYSTEM_COPY,
    title: "Copy Selected Entries",
    shortcut: "Ctrl+C",
    triggers: ["shortcut", "palette", "context-menu"],
    scope: "filesystem",
    whenText: "((activePanelType === \"Filesystem\" && isFilesystemBrowsing) || ((targetType === \"file\" || targetType === \"folder\") && targetScope === \"tree-entry\")) && hasSelectedEntries()",
    when: (context) => {
      if (!isFilesystemCommandContext(context)) return false;
      if (!hasSelectedEntries(context)) return false;
      if (!isContextMenuSource(context)) return true;
      return isFilesystemTreeEntryContextTarget(context);
    },
    shortcutMatcher: event =>
      event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "c",
  },
  {
    id: COMMAND_IDS.FILESYSTEM_CUT,
    title: "Cut Selected Entries",
    shortcut: "Ctrl+X",
    triggers: ["shortcut", "palette", "context-menu"],
    scope: "filesystem",
    whenText: "((activePanelType === \"Filesystem\" && isFilesystemBrowsing) || ((targetType === \"file\" || targetType === \"folder\") && targetScope === \"tree-entry\")) && hasSelectedEntries()",
    when: (context) => {
      if (!isFilesystemCommandContext(context)) return false;
      if (!hasSelectedEntries(context)) return false;
      if (!isContextMenuSource(context)) return true;
      return isFilesystemTreeEntryContextTarget(context);
    },
    shortcutMatcher: event =>
      event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "x",
  },
  {
    id: COMMAND_IDS.FILESYSTEM_PASTE,
    title: "Paste Entries",
    shortcut: "Ctrl+V",
    triggers: ["shortcut", "palette", "context-menu"],
    scope: "filesystem",
    whenText: "source === \"context-menu\" ? (isFilesystemBrowsing && (targetType === \"folder\" && targetScope === \"tree-entry\" || (targetType === \"panel\" && targetPanelType === \"Filesystem\"))) : (activePanelType === \"Filesystem\" && isFilesystemBrowsing)",
    when: (context) => {
      if (isContextMenuSource(context)) return (
        isFilesystemBrowsing(context)
        && isFilesystemPasteContextTarget(context)
      );
      return isFilesystemPanelActive(context) && isFilesystemBrowsing(context);
    },
    shortcutMatcher: event =>
      event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "v",
  },
  {
    id: COMMAND_IDS.PANE_TOGGLE_MAXIMIZE,
    title: "Toggle Active Pane Maximize",
    shortcut: "Ctrl+Space",
    triggers: [],
    scope: "pane",
    state: "planned",
    whenText: "hasActivePane()",
    when: hasActivePane,
  },
  {
    id: COMMAND_IDS.FILESYSTEM_BULK_RENAME,
    title: "Bulk Rename Selected Entries",
    shortcut: "F2 (multiple selection)",
    triggers: [],
    scope: "filesystem",
    state: "planned",
    whenText: "activePanelType === \"Filesystem\" && isFilesystemBrowsing && hasSelectedEntries()",
    when: (context) => (
      isFilesystemPanelActive(context)
      && isFilesystemBrowsing(context)
      && hasSelectedEntries(context)
    ),
  },
  {
    id: COMMAND_IDS.FILESYSTEM_FILTER_CURRENT_FOLDER,
    title: "Filter Current Folder",
    shortcut: "Ctrl+F",
    triggers: [],
    scope: "filesystem",
    state: "planned",
    whenText: "activePanelType === \"Filesystem\" && isFilesystemBrowsing",
    when: context => isFilesystemPanelActive(context) && isFilesystemBrowsing(context),
  },
  {
    id: COMMAND_IDS.FILESYSTEM_SEARCH_CURRENT_SUBTREE,
    title: "Search Current Folder and Subfolders",
    shortcut: "Ctrl+Shift+F",
    triggers: [],
    scope: "filesystem",
    state: "planned",
    whenText: "activePanelType === \"Filesystem\" && isFilesystemBrowsing",
    when: context => isFilesystemPanelActive(context) && isFilesystemBrowsing(context),
  },
  {
    id: COMMAND_IDS.FILESYSTEM_OPEN_RECENT_FOLDERS,
    title: "Open Recently Opened Folders",
    shortcut: "Ctrl+R",
    triggers: [],
    scope: "filesystem",
    state: "planned",
    whenText: "activePanelType === \"Filesystem\"",
    when: isFilesystemPanelActive,
  },
  {
    id: COMMAND_IDS.FILESYSTEM_CREATE_TEXT_FILE,
    title: "Create Text File",
    shortcut: "Ctrl+Shift+T",
    triggers: ["shortcut", "palette", "context-menu"],
    scope: "filesystem",
    whenText: "source === \"context-menu\" ? (isFilesystemBrowsing && (targetType === \"folder\" && targetScope === \"tree-entry\" || (targetType === \"panel\" && targetPanelType === \"Filesystem\"))) : (activePanelType === \"Filesystem\" && isFilesystemBrowsing)",
    when: (context) => {
      if (isContextMenuSource(context)) return (
        isFilesystemBrowsing(context)
        && (
          isFilesystemTreeFolderContextTarget(context)
          || isFilesystemPanelContextTarget(context)
        )
      );
      return isFilesystemPanelActive(context) && isFilesystemBrowsing(context);
    },
    shortcutMatcher: event =>
      event.ctrlKey
      && event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "t",
  },
  {
    id: COMMAND_IDS.FILESYSTEM_CREATE_FOLDER,
    title: "Create Folder",
    shortcut: "Ctrl+Shift+N",
    triggers: ["shortcut", "palette", "context-menu"],
    scope: "filesystem",
    whenText: "source === \"context-menu\" ? (isFilesystemBrowsing && (targetType === \"folder\" && targetScope === \"tree-entry\" || (targetType === \"panel\" && targetPanelType === \"Filesystem\"))) : (activePanelType === \"Filesystem\" && isFilesystemBrowsing)",
    when: (context) => {
      if (isContextMenuSource(context)) return (
        isFilesystemBrowsing(context)
        && (
          isFilesystemTreeFolderContextTarget(context)
          || isFilesystemPanelContextTarget(context)
        )
      );
      return isFilesystemPanelActive(context) && isFilesystemBrowsing(context);
    },
    shortcutMatcher: event =>
      event.ctrlKey
      && event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "n",
  },
  {
    id: COMMAND_IDS.WORKSPACE_RUN_SCRIPT,
    title: "Run Workspace Script",
    shortcut: "From Command Palette / Context Menu",
    triggers: [],
    scope: "workspace",
    state: "planned",
    whenText: "tab has workspace folder scripts in .grayspace/folder.json",
    when: () => false,
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

export function formatCommandState(command) {
  return command?.state === "planned" ? "Planned" : "Active";
}
