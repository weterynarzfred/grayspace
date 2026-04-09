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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("filters commands based on query and runs the filtered selection", () => {
    const onCommand = vi.fn();
    render(<CommandPalettePopover open commands={createCommands()} onCommand={onCommand} />);
    const input = screen.getByPlaceholderText("Type a command");

    fireEvent.change(input, { target: { value: "second" } });
    expect(screen.getByRole("button", { name: /Second command/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /First command/i })).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommand).toHaveBeenCalledWith("two");
  });

  it("scrolls the selected command into view when navigating with arrow keys", () => {
    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoViewMock,
    });

    try {
      render(<CommandPalettePopover open commands={createCommands()} onCommand={vi.fn()} />);
      const input = screen.getByPlaceholderText("Type a command");

      fireEvent.keyDown(input, { key: "ArrowDown" });

      expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      if (typeof originalScrollIntoView === "function") {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          writable: true,
          value: originalScrollIntoView,
        });
      } else {
        delete HTMLElement.prototype.scrollIntoView;
      }
    }
  });
});
