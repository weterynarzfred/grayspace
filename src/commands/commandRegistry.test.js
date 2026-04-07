import {
  COMMANDS,
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
    expect(getCommandIds(shortcutCommands)).toContain("filesystem.createTextFile");
    expect(getCommandIds(shortcutCommands)).toContain("filesystem.createFolder");
    expect(getCommandIds(shortcutCommands)).not.toContain("filesystem.copy");
  });

  it("keeps planned commands listed in the registry", () => {
    const commandIds = COMMANDS.map(command => command.id);
    expect(commandIds).toContain("filesystem.copy");
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
});
