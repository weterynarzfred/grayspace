import { fireEvent, render, screen } from "@testing-library/react";
import CommandPalettePopover from "./CommandPalettePopover";

function createCommands() {
  return [
    { id: "one", title: "First command", shortcut: "Alt+1" },
    { id: "two", title: "Second command", shortcut: "Alt+2" },
    { id: "three", title: "Third command", shortcut: "Alt+3" },
  ];
}

describe("CommandPalettePopover", () => {
  it("runs the first command on Enter by default", () => {
    const onCommand = vi.fn();
    render(<CommandPalettePopover open commands={createCommands()} onCommand={onCommand} />);

    fireEvent.keyDown(screen.getByPlaceholderText("Type a command"), { key: "Enter" });
    expect(onCommand).toHaveBeenCalledWith("one");
  });

  it("moves selection with arrows and runs the selected command on Enter", () => {
    const onCommand = vi.fn();
    render(<CommandPalettePopover open commands={createCommands()} onCommand={onCommand} />);
    const input = screen.getByPlaceholderText("Type a command");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommand).toHaveBeenCalledWith("three");
  });

  it("wraps selection when pressing ArrowUp from the first item", () => {
    const onCommand = vi.fn();
    render(<CommandPalettePopover open commands={createCommands()} onCommand={onCommand} />);
    const input = screen.getByPlaceholderText("Type a command");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommand).toHaveBeenCalledWith("three");
  });
});
