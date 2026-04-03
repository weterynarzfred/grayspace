import { getCommandsForTrigger } from "./commandRegistry";

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
});
