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
  FILESYSTEM_NAVIGATE_BACK: "filesystem.navigateBack",
  FILESYSTEM_NAVIGATE_FORWARD: "filesystem.navigateForward",
  FILESYSTEM_DELETE_SELECTED: "filesystem.deleteSelected",
  FILESYSTEM_RENAME_SELECTED: "filesystem.renameSelected",
  FILESYSTEM_BULK_RENAME: "filesystem.bulkRename",
  FILESYSTEM_COPY: "filesystem.copy",
  FILESYSTEM_CUT: "filesystem.cut",
  FILESYSTEM_PASTE: "filesystem.paste",
  FILESYSTEM_FILTER_CURRENT_FOLDER: "filesystem.filterCurrentFolder",
  FILESYSTEM_SEARCH_CURRENT_SUBTREE: "filesystem.searchCurrentSubtree",
  FILESYSTEM_FOCUS_BREADCRUMB_INPUT: "filesystem.focusBreadcrumbInput",
  FILESYSTEM_OPEN_RECENT_FOLDERS: "filesystem.openRecentFolders",
  FILESYSTEM_CREATE_TEXT_FILE: "filesystem.createTextFile",
  FILESYSTEM_CREATE_FOLDER: "filesystem.createFolder",
  FILESYSTEM_VIEW: "filesystem.view",
  FILESYSTEM_VIEW_FOLDER_TREE: "filesystem.view.folderTree",
  FILESYSTEM_VIEW_DETAILS: "filesystem.view.details",
  FILESYSTEM_VIEW_GRID: "filesystem.view.grid",
  FILESYSTEM_VIEW_FOLDABLE_GRID: "filesystem.view.foldableGrid",
  FILESYSTEM_TOGGLE_HIDDEN: "filesystem.view.toggleHidden",
  FILESYSTEM_SORT: "filesystem.sort",
  FILESYSTEM_SORT_BY_NAME: "filesystem.sort.name",
  FILESYSTEM_SORT_BY_MODIFIED: "filesystem.sort.modified",
  FILESYSTEM_SORT_BY_SIZE: "filesystem.sort.size",
  FILESYSTEM_SORT_BY_TYPE: "filesystem.sort.type",
  FILESYSTEM_SORT_REVERSE: "filesystem.sort.reverse",
  FILESYSTEM_SHOW_SHELL_MENU: "filesystem.showShellMenu",
  WORKSPACE_RUN_SCRIPT: "workspace.runScript",
};

const CONTEXT_MENU_TARGETS = new Set(["file", "folder"]);

function getSelectedEntryPaths(context) {
  return uniqueNonEmptyPaths(context?.selectedPaths);
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

// `getMark(context)` returns what menus show next to an option that is currently on ("" when off).
function filesystemPanelPaletteCommand(id, title, getMark = undefined) {
  return {
    id,
    title,
    triggers: ["palette"],
    scope: "filesystem",
    whenText: "activePanelType === \"Filesystem\"",
    when: isFilesystemPanelActive,
    getMark,
  };
}

const markCurrentViewType = viewType => context => (context.filesystemViewType === viewType ? "✓" : "");

// The arrow also tells the direction, like the details column headers.
const markCurrentSortKey = sortKey => (context) => {
  if (context.filesystemSortKey !== sortKey) return "";
  return context.filesystemSortDescending ? "▾" : "▴";
};

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
    triggers: ["shortcut", "palette"],
    scope: "pane",
    whenText: "hasActivePane()",
    when: (context) => hasActivePane(context),
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
    triggers: ["shortcut", "palette"],
    scope: "pane",
    whenText: "hasActivePane()",
    when: (context) => hasActivePane(context),
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
    id: COMMAND_IDS.FILESYSTEM_NAVIGATE_BACK,
    title: "Go Back in Folder History",
    shortcut: "Alt+ArrowLeft",
    triggers: ["shortcut", "palette"],
    scope: "filesystem",
    whenText: "activePanelType === \"Filesystem\"",
    when: context => isFilesystemPanelActive(context),
    shortcutMatcher: event =>
      event.altKey
      && !event.ctrlKey
      && !event.shiftKey
      && !event.metaKey
      && event.key === "ArrowLeft",
  },
  {
    id: COMMAND_IDS.FILESYSTEM_NAVIGATE_FORWARD,
    title: "Go Forward in Folder History",
    shortcut: "Alt+ArrowRight",
    triggers: ["shortcut", "palette"],
    scope: "filesystem",
    whenText: "activePanelType === \"Filesystem\"",
    when: context => isFilesystemPanelActive(context),
    shortcutMatcher: event =>
      event.altKey
      && !event.ctrlKey
      && !event.shiftKey
      && !event.metaKey
      && event.key === "ArrowRight",
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
    triggers: ["shortcut", "palette"],
    scope: "filesystem",
    whenText: "activePanelType === \"Filesystem\" && isFilesystemBrowsing",
    when: context => isFilesystemPanelActive(context) && isFilesystemBrowsing(context),
    shortcutMatcher: event =>
      event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "f",
  },
  {
    id: COMMAND_IDS.FILESYSTEM_SEARCH_CURRENT_SUBTREE,
    title: "Search Current Folder and Subfolders",
    shortcut: "Ctrl+Shift+F",
    triggers: ["shortcut", "palette"],
    scope: "filesystem",
    whenText: "activePanelType === \"Filesystem\" && isFilesystemBrowsing",
    when: context => isFilesystemPanelActive(context) && isFilesystemBrowsing(context),
    shortcutMatcher: event =>
      event.ctrlKey
      && event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "f",
  },
  {
    id: COMMAND_IDS.FILESYSTEM_FOCUS_BREADCRUMB_INPUT,
    title: "Focus Breadcrumb Input",
    shortcut: "Ctrl+L / Alt+D",
    triggers: ["shortcut", "palette"],
    scope: "filesystem",
    whenText: "activePanelType === \"Filesystem\" && isFilesystemBrowsing",
    when: context => isFilesystemPanelActive(context) && isFilesystemBrowsing(context),
    shortcutMatcher: event =>
      (
        event.ctrlKey
        && !event.shiftKey
        && !event.altKey
        && !event.metaKey
        && event.key.toLowerCase() === "l"
      )
      || (
        !event.ctrlKey
        && !event.shiftKey
        && event.altKey
        && !event.metaKey
        && event.key.toLowerCase() === "d"
      ),
  },
  {
    id: COMMAND_IDS.FILESYSTEM_OPEN_RECENT_FOLDERS,
    title: "Open Recently Opened Folders",
    shortcut: "Ctrl+R",
    triggers: ["shortcut", "palette"],
    scope: "tab",
    whenText: "hasActiveTab()",
    when: hasActiveTab,
    shortcutMatcher: event =>
      event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "r",
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
  filesystemPanelPaletteCommand(
    COMMAND_IDS.FILESYSTEM_VIEW_FOLDER_TREE,
    "View: Folder Tree",
    markCurrentViewType("folder-tree"),
  ),
  filesystemPanelPaletteCommand(COMMAND_IDS.FILESYSTEM_VIEW_DETAILS, "View: Details", markCurrentViewType("details")),
  filesystemPanelPaletteCommand(COMMAND_IDS.FILESYSTEM_VIEW_GRID, "View: Grid", markCurrentViewType("grid")),
  filesystemPanelPaletteCommand(
    COMMAND_IDS.FILESYSTEM_VIEW_FOLDABLE_GRID,
    "View: Foldable Grid",
    markCurrentViewType("foldable-grid"),
  ),
  {
    id: COMMAND_IDS.FILESYSTEM_TOGGLE_HIDDEN,
    title: "View: Show Hidden Files",
    getMark: context => (context.showHiddenFiles ? "✓" : ""),
    shortcut: "Ctrl+H",
    triggers: ["shortcut", "palette"],
    scope: "filesystem",
    whenText: "activePanelType === \"Filesystem\"",
    when: isFilesystemPanelActive,
    shortcutMatcher: event =>
      event.ctrlKey
      && !event.shiftKey
      && !event.altKey
      && !event.metaKey
      && event.key.toLowerCase() === "h",
  },
  filesystemPanelPaletteCommand(COMMAND_IDS.FILESYSTEM_SORT_BY_NAME, "Sort: Name", markCurrentSortKey("name")),
  filesystemPanelPaletteCommand(
    COMMAND_IDS.FILESYSTEM_SORT_BY_MODIFIED,
    "Sort: Date Modified",
    markCurrentSortKey("modified"),
  ),
  filesystemPanelPaletteCommand(COMMAND_IDS.FILESYSTEM_SORT_BY_SIZE, "Sort: Size", markCurrentSortKey("size")),
  filesystemPanelPaletteCommand(COMMAND_IDS.FILESYSTEM_SORT_BY_TYPE, "Sort: Type", markCurrentSortKey("type")),
  filesystemPanelPaletteCommand(COMMAND_IDS.FILESYSTEM_SORT_REVERSE, "Sort: Reverse Order"),
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

function filesystemPanelSubmenu(id, title, commandIds) {
  return {
    id,
    title,
    triggers: ["context-menu"],
    scope: "filesystem",
    submenu: COMMANDS.filter(command => commandIds.includes(command.id)),
    whenText: "targetType === \"panel\" && targetPanelType === \"Filesystem\"",
    when: isFilesystemPanelContextTarget,
  };
}
COMMANDS.push(
  filesystemPanelSubmenu(COMMAND_IDS.FILESYSTEM_VIEW, "View", [
    COMMAND_IDS.FILESYSTEM_VIEW_FOLDER_TREE,
    COMMAND_IDS.FILESYSTEM_VIEW_DETAILS,
    COMMAND_IDS.FILESYSTEM_VIEW_GRID,
    COMMAND_IDS.FILESYSTEM_VIEW_FOLDABLE_GRID,
    COMMAND_IDS.FILESYSTEM_TOGGLE_HIDDEN,
  ]),
  filesystemPanelSubmenu(COMMAND_IDS.FILESYSTEM_SORT, "Sort By", [
    COMMAND_IDS.FILESYSTEM_SORT_BY_NAME,
    COMMAND_IDS.FILESYSTEM_SORT_BY_MODIFIED,
    COMMAND_IDS.FILESYSTEM_SORT_BY_SIZE,
    COMMAND_IDS.FILESYSTEM_SORT_BY_TYPE,
    COMMAND_IDS.FILESYSTEM_SORT_REVERSE,
  ]),
  {
    id: COMMAND_IDS.FILESYSTEM_SHOW_SHELL_MENU,
    title: "Show More Options",
    shortcut: "Shift+Right-click",
    triggers: ["context-menu"],
    scope: "filesystem",
    whenText: "((targetType === \"file\" || targetType === \"folder\") && targetScope === \"tree-entry\" && hasSelectedEntries()) || (targetType === \"panel\" && targetPanelType === \"Filesystem\" && isFilesystemBrowsing)",
    when: context => (
      (isFilesystemTreeEntryContextTarget(context) && hasSelectedEntries(context))
      || (isFilesystemPanelContextTarget(context) && isFilesystemBrowsing(context))
    ),
  },
);

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
