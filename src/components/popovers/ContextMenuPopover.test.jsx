import { fireEvent, render, screen } from "@testing-library/react";
import ContextMenuPopover from "./ContextMenuPopover";

function createTarget() {
  return {
    kind: "file",
    id: "target-1",
    label: "notes.txt",
    path: "C:\\notes.txt",
  };
}

function createCommands() {
  return [
    { id: "one", title: "First action", shortcut: "F1" },
    { id: "two", title: "Second action", shortcut: "F2" },
  ];
}

describe("ContextMenuPopover", () => {
  it("executes the first command on Enter by default", () => {
    const onCommand = vi.fn();
    render(<ContextMenuPopover
      open
      target={createTarget()}
      commands={createCommands()}
      onCommand={onCommand}
    />);

    fireEvent.keyDown(screen.getByTestId("context-menu-root"), { key: "Enter" });
    expect(onCommand).toHaveBeenCalledWith("one");
  });

  it("changes selected command with arrows and executes selected on Enter", () => {
    const onCommand = vi.fn();
    render(<ContextMenuPopover
      open
      target={createTarget()}
      commands={createCommands()}
      onCommand={onCommand}
    />);
    const root = screen.getByTestId("context-menu-root");

    fireEvent.keyDown(root, { key: "ArrowDown" });
    fireEvent.keyDown(root, { key: "Enter" });
    expect(onCommand).toHaveBeenCalledWith("two");
  });
});

describe("ContextMenuPopover option marks", () => {
  it("marks the options in a submenu that are currently on", () => {
    const markCurrentView = viewType => context => (context.viewType === viewType ? "✓" : "");
    render(<ContextMenuPopover
      open
      target={createTarget()}
      context={{ viewType: "grid" }}
      commands={[{
        id: "view",
        title: "View",
        submenu: [
          { id: "grid", title: "Grid", getMark: markCurrentView("grid") },
          { id: "details", title: "Details", getMark: markCurrentView("details") },
          { id: "refresh", title: "Refresh" },
        ],
      }]}
    />);

    fireEvent.click(screen.getByRole("button", { name: /View/ }));

    const gridButton = screen.getByRole("button", { name: "Grid" });
    expect(gridButton).toHaveAttribute("aria-pressed", "true");
    expect(gridButton).toHaveTextContent("Grid✓");
    expect(screen.getByRole("button", { name: "Details" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Refresh" })).not.toHaveAttribute("aria-pressed");
  });
});
