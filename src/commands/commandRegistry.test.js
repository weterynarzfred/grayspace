import {
  COMMANDS,
  formatCommandState,
  formatCommandWhen,
  getCommandsForTrigger,
  isCommandShortcutMatch,
} from "./commandRegistry";

function getCommandIds(commands) {
  return commands.map(command => command.id);
}

describe("commandRegistry", () => {
  it("filters filesystem commands by selection for the command palette", () => {
    const commandsWithoutSelection = getCommandsForTrigger("palette", {
      source: "palette",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: [],
    });
    const commandsWithSelection = getCommandsForTrigger("palette", {
      source: "palette",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["C:\\notes.txt"],
    });

    expect(getCommandIds(commandsWithoutSelection)).not.toContain("filesystem.deleteSelected");
    expect(getCommandIds(commandsWithoutSelection)).not.toContain("filesystem.renameSelected");
    expect(getCommandIds(commandsWithSelection)).toContain("filesystem.deleteSelected");
    expect(getCommandIds(commandsWithSelection)).toContain("filesystem.renameSelected");
  });

  it("keeps non-entry selection ids out of rename availability", () => {
    const commands = getCommandsForTrigger("palette", {
      source: "palette",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["__up__"],
    });

    expect(getCommandIds(commands)).not.toContain("filesystem.renameSelected");
  });

  it("shows split commands only for panel targets in context menus", () => {
    const fileTargetCommands = getCommandsForTrigger("context-menu", {
      source: "context-menu",
      targetType: "file",
      targetScope: "tree-entry",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      selectedPaths: ["C:\\notes.txt"],
    });
    const panelTargetCommands = getCommandsForTrigger("context-menu", {
      source: "context-menu",
      targetType: "panel",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      selectedPaths: [],
    });

    expect(getCommandIds(fileTargetCommands)).not.toContain("pane.split.vertical");
    expect(getCommandIds(fileTargetCommands)).not.toContain("pane.split.horizontal");
    expect(getCommandIds(panelTargetCommands)).toContain("pane.split.vertical");
    expect(getCommandIds(panelTargetCommands)).toContain("pane.split.horizontal");
  });

  it("shows open-folder-in-new-tab command for folder context targets only", () => {
    const folderTargetCommands = getCommandsForTrigger("context-menu", {
      source: "context-menu",
      targetType: "folder",
      targetScope: "tree-entry",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      selectedPaths: ["C:\\Users"],
    });
    const fileTargetCommands = getCommandsForTrigger("context-menu", {
      source: "context-menu",
      targetType: "file",
      targetScope: "tree-entry",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      selectedPaths: ["C:\\notes.txt"],
    });

    expect(getCommandIds(folderTargetCommands)).toContain("filesystem.openSelectedFolderInNewTab");
    expect(getCommandIds(fileTargetCommands)).not.toContain("filesystem.openSelectedFolderInNewTab");
  });

  it("shows create commands for filesystem panel and folder context targets only while browsing", () => {
    const panelTargetCommands = getCommandsForTrigger("context-menu", {
      source: "context-menu",
      targetType: "panel",
      targetPanelType: "Filesystem",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: [],
    });
    const folderTargetCommands = getCommandsForTrigger("context-menu", {
      source: "context-menu",
      targetType: "folder",
      targetScope: "tree-entry",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["C:\\Users"],
    });
    const drivesPanelCommands = getCommandsForTrigger("context-menu", {
      source: "context-menu",
      targetType: "panel",
      targetPanelType: "Filesystem",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: false,
      selectedPaths: [],
    });
    const fileTargetCommands = getCommandsForTrigger("context-menu", {
      source: "context-menu",
      targetType: "file",
      targetScope: "tree-entry",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["C:\\notes.txt"],
    });

    expect(getCommandIds(panelTargetCommands)).toContain("filesystem.createTextFile");
    expect(getCommandIds(panelTargetCommands)).toContain("filesystem.createFolder");
    expect(getCommandIds(folderTargetCommands)).toContain("filesystem.createTextFile");
    expect(getCommandIds(folderTargetCommands)).toContain("filesystem.createFolder");
    expect(getCommandIds(drivesPanelCommands)).not.toContain("filesystem.createTextFile");
    expect(getCommandIds(drivesPanelCommands)).not.toContain("filesystem.createFolder");
    expect(getCommandIds(fileTargetCommands)).not.toContain("filesystem.createTextFile");
    expect(getCommandIds(fileTargetCommands)).not.toContain("filesystem.createFolder");
  });

  it("keeps open-folder-in-new-tab available for single directory selection", () => {
    const commands = getCommandsForTrigger("palette", {
      source: "palette",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["C:\\Users"],
      selectedEntryKinds: {
        "C:\\Users": "folder",
      },
    });

    expect(getCommandIds(commands)).toContain("filesystem.openSelectedFolderInNewTab");
  });

  it("maps properties pane switch shortcut to ctrl+shift+o", () => {
    expect(isCommandShortcutMatch("pane.switch.properties", {
      key: "o",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    })).toBe(true);
    expect(isCommandShortcutMatch("pane.switch.properties", {
      key: "i",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    })).toBe(false);
  });

  it("returns active tab switch command for shortcut trigger", () => {
    const shortcutCommands = getCommandsForTrigger("shortcut", {
      source: "shortcut",
      activeTabId: "tab-1",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["C:\\notes.txt"],
    });

    expect(getCommandIds(shortcutCommands)).toContain("tab.switch.next");
    expect(getCommandIds(shortcutCommands)).toContain("filesystem.openRecentFolders");
    expect(getCommandIds(shortcutCommands)).toContain("filesystem.createTextFile");
    expect(getCommandIds(shortcutCommands)).toContain("filesystem.createFolder");
    expect(getCommandIds(shortcutCommands)).toContain("filesystem.copy");
    expect(getCommandIds(shortcutCommands)).toContain("filesystem.cut");
    expect(getCommandIds(shortcutCommands)).toContain("filesystem.paste");
  });

  it("shows focus-breadcrumb command only when filesystem browsing is active", () => {
    const browsingCommands = getCommandsForTrigger("shortcut", {
      source: "shortcut",
      activeTabId: "tab-1",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
    });
    const drivesCommands = getCommandsForTrigger("shortcut", {
      source: "shortcut",
      activeTabId: "tab-1",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: false,
    });

    expect(getCommandIds(browsingCommands)).toContain("filesystem.focusBreadcrumbInput");
    expect(getCommandIds(drivesCommands)).not.toContain("filesystem.focusBreadcrumbInput");
  });

  it("hides open-recent command when there is no active tab", () => {
    const commands = getCommandsForTrigger("shortcut", {
      source: "shortcut",
      activeTabId: "",
    });

    expect(getCommandIds(commands)).not.toContain("filesystem.openRecentFolders");
  });

  it("keeps planned commands listed in the registry", () => {
    const commandIds = COMMANDS.map(command => command.id);
    expect(commandIds).toContain("workspace.runScript");
  });

  it("maps next tab shortcut to ctrl+tab", () => {
    expect(isCommandShortcutMatch("tab.switch.next", {
      key: "Tab",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    })).toBe(true);
  });

  it("maps create shortcuts to ctrl+shift+t and ctrl+shift+n", () => {
    expect(isCommandShortcutMatch("filesystem.createTextFile", {
      key: "T",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    })).toBe(true);

    expect(isCommandShortcutMatch("filesystem.createFolder", {
      key: "n",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    })).toBe(true);
  });

  it("maps open-recent shortcut to ctrl+r", () => {
    expect(isCommandShortcutMatch("filesystem.openRecentFolders", {
      key: "r",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    })).toBe(true);
  });

  it("shows paste in filesystem panel and folder context targets while browsing", () => {
    const panelTargetCommands = getCommandsForTrigger("context-menu", {
      source: "context-menu",
      targetType: "panel",
      targetPanelType: "Filesystem",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: [],
    });
    const folderTargetCommands = getCommandsForTrigger("context-menu", {
      source: "context-menu",
      targetType: "folder",
      targetScope: "tree-entry",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["C:\\Users"],
    });
    const fileTargetCommands = getCommandsForTrigger("context-menu", {
      source: "context-menu",
      targetType: "file",
      targetScope: "tree-entry",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["C:\\notes.txt"],
    });

    expect(getCommandIds(panelTargetCommands)).toContain("filesystem.paste");
    expect(getCommandIds(folderTargetCommands)).toContain("filesystem.paste");
    expect(getCommandIds(fileTargetCommands)).not.toContain("filesystem.paste");
  });

  it("maps copy, cut, and paste shortcuts to ctrl+c/x/v", () => {
    expect(isCommandShortcutMatch("filesystem.copy", {
      key: "c",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    })).toBe(true);

    expect(isCommandShortcutMatch("filesystem.cut", {
      key: "x",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    })).toBe(true);

    expect(isCommandShortcutMatch("filesystem.paste", {
      key: "v",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    })).toBe(true);
  });

  it("maps focus-breadcrumb shortcut to ctrl+l and alt+d", () => {
    expect(isCommandShortcutMatch("filesystem.focusBreadcrumbInput", {
      key: "l",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    })).toBe(true);

    expect(isCommandShortcutMatch("filesystem.focusBreadcrumbInput", {
      key: "D",
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      metaKey: false,
    })).toBe(true);

    expect(isCommandShortcutMatch("filesystem.focusBreadcrumbInput", {
      key: "l",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    })).toBe(false);
  });

  it("maps redo shortcut to both ctrl+y and ctrl+shift+z", () => {
    expect(isCommandShortcutMatch("filesystem.redo", {
      key: "y",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    })).toBe(true);

    expect(isCommandShortcutMatch("filesystem.redo", {
      key: "z",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    })).toBe(true);
  });

  it("uses trigger as source when context source is omitted", () => {
    const commands = getCommandsForTrigger("context-menu", {
      targetType: "folder",
      targetScope: "tree-entry",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["C:\\Users"],
    });

    expect(getCommandIds(commands)).toContain("filesystem.openSelectedFolderInNewTab");
  });

  it("formats command state and when metadata for settings", () => {
    const plannedCommand = COMMANDS.find(command => command.id === "workspace.runScript");
    const activeCommand = COMMANDS.find(command => command.id === "pane.split.vertical");

    expect(formatCommandState(plannedCommand)).toBe("Planned");
    expect(formatCommandState(activeCommand)).toBe("Active");
    expect(formatCommandState(undefined)).toBe("Active");

    expect(formatCommandWhen(plannedCommand)).toContain("workspace folder scripts");
    expect(formatCommandWhen({})).toBe("true");
  });

  it("keeps delete/copy/cut hidden for non-entry context-menu targets", () => {
    const commands = getCommandsForTrigger("context-menu", {
      source: "context-menu",
      targetType: "panel",
      targetPanelType: "Filesystem",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["C:\\notes.txt"],
    });

    const commandIds = getCommandIds(commands);
    expect(commandIds).not.toContain("filesystem.deleteSelected");
    expect(commandIds).not.toContain("filesystem.copy");
    expect(commandIds).not.toContain("filesystem.cut");
  });

  it("shows delete/copy/cut for tree-entry context-menu targets with selection", () => {
    const commands = getCommandsForTrigger("context-menu", {
      source: "context-menu",
      targetType: "file",
      targetScope: "tree-entry",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["C:\\notes.txt"],
    });

    const commandIds = getCommandIds(commands);
    expect(commandIds).toContain("filesystem.deleteSelected");
    expect(commandIds).toContain("filesystem.copy");
    expect(commandIds).toContain("filesystem.cut");
  });

  it("hides open-folder-in-new-tab for single file selections", () => {
    const commands = getCommandsForTrigger("palette", {
      source: "palette",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["C:\\notes.txt"],
      selectedEntryKinds: {
        "C:\\notes.txt": "file",
      },
    });

    expect(getCommandIds(commands)).not.toContain("filesystem.openSelectedFolderInNewTab");
  });

  it("normalizes duplicate path selections for rename availability", () => {
    const commands = getCommandsForTrigger("palette", {
      source: "palette",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["", "C:\\notes.txt", "C:\\notes.txt"],
    });

    expect(getCommandIds(commands)).toContain("filesystem.renameSelected");
  });

  it("hides paste in context menus when filesystem browsing is inactive", () => {
    const commands = getCommandsForTrigger("context-menu", {
      source: "context-menu",
      targetType: "folder",
      targetScope: "tree-entry",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: false,
      selectedPaths: ["C:\\Users"],
    });

    expect(getCommandIds(commands)).not.toContain("filesystem.paste");
  });

  it("does not expose planned no-trigger commands through trigger queries", () => {
    const paletteCommands = getCommandsForTrigger("palette", {
      source: "palette",
      activeTabId: "tab-1",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["C:\\notes.txt"],
    });
    const shortcutCommands = getCommandsForTrigger("shortcut", {
      source: "shortcut",
      activeTabId: "tab-1",
      activePaneId: "pane-1",
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["C:\\notes.txt"],
    });

    expect(getCommandIds(paletteCommands)).not.toContain("workspace.runScript");
    expect(getCommandIds(shortcutCommands)).not.toContain("workspace.runScript");
  });

  it("returns false for shortcut matching on unknown and no-shortcut commands", () => {
    const event = {
      key: "r",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    };

    expect(isCommandShortcutMatch("workspace.runScript", event)).toBe(false);
    expect(isCommandShortcutMatch("workspace.unknown", event)).toBe(false);
  });

  it("maps external-ui, undo, open-folder, and go-up shortcuts", () => {
    expect(isCommandShortcutMatch("pane.switch.externalUi", {
      key: "u",
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    })).toBe(true);

    expect(isCommandShortcutMatch("filesystem.undo", {
      key: "Z",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    })).toBe(true);

    expect(isCommandShortcutMatch("filesystem.openSelectedFolderInNewTab", {
      key: "Enter",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    })).toBe(true);

    expect(isCommandShortcutMatch("filesystem.goUp", {
      key: "ArrowUp",
      ctrlKey: false,
      shiftKey: false,
      altKey: true,
      metaKey: false,
    })).toBe(true);
  });

  it("evaluates planned filesystem command predicates against filesystem context", () => {
    const bulkRenameCommand = COMMANDS.find(command => command.id === "filesystem.bulkRename");
    const filterCommand = COMMANDS.find(command => command.id === "filesystem.filterCurrentFolder");
    const searchCommand = COMMANDS.find(command => command.id === "filesystem.searchCurrentSubtree");

    expect(bulkRenameCommand.when({
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: ["C:\\one.txt", "C:\\two.txt"],
    })).toBe(true);
    expect(bulkRenameCommand.when({
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
      selectedPaths: [],
    })).toBe(false);

    expect(filterCommand.when({
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
    })).toBe(true);
    expect(filterCommand.when({
      activePanelType: "Terminal",
      isFilesystemBrowsing: true,
    })).toBe(false);

    expect(searchCommand.when({
      activePanelType: "Filesystem",
      isFilesystemBrowsing: true,
    })).toBe(true);
    expect(searchCommand.when({
      activePanelType: "Filesystem",
      isFilesystemBrowsing: false,
    })).toBe(false);
  });

  it("keeps run-script command predicate disabled by default", () => {
    const runScriptCommand = COMMANDS.find(command => command.id === "workspace.runScript");
    expect(runScriptCommand.when({
      activeTabId: "tab-1",
      activePaneId: "pane-1",
    })).toBe(false);
  });
});
