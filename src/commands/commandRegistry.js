export const COMMANDS = [
  {
    id: "commandPalette.open",
    title: "Open Command Palette",
    shortcut: "Ctrl+Shift+P",
    surfaces: ["shortcut", "palette"],
    scope: "global",
  },
  {
    id: "pane.split.vertical",
    title: "Split Active Pane Vertically",
    shortcut: "Alt+V",
    surfaces: ["shortcut", "palette"],
    scope: "pane",
  },
  {
    id: "pane.split.horizontal",
    title: "Split Active Pane Horizontally",
    shortcut: "Alt+H",
    surfaces: ["shortcut", "palette"],
    scope: "pane",
  },
  {
    id: "filesystem.deleteSelected",
    title: "Delete Selected Files/Folders",
    shortcut: "Delete",
    surfaces: ["shortcut", "palette", "context-menu"],
    scope: "filesystem",
  },
  {
    id: "tab.close",
    title: "Close Tab",
    shortcut: "Middle Click Tab",
    surfaces: ["shortcut", "context-menu"],
    scope: "tab",
  },
];

export function formatCommandSurfaces(command) {
  return (command?.surfaces ?? []).join(", ");
}
