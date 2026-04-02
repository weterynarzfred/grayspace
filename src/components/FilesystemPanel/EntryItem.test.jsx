import { fireEvent, render, screen, within } from "@testing-library/react";
import EntryItem from "./EntryItem";

describe("EntryItem", () => {
  it("renders label/meta and selected state", () => {
    render(<EntryItem label="Users" meta="Folder" isSelected />);

    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Folder")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Users/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("fires click and double click handlers", () => {
    const handleClick = vi.fn();
    const handleDoubleClick = vi.fn();

    render(
      <EntryItem
        label="notes.txt"
        meta="File"
        isFile
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      />,
    );

    const button = screen.getByRole("button", { name: /notes\.txt/i });
    fireEvent.click(button);
    fireEvent.doubleClick(button);

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleDoubleClick).toHaveBeenCalledTimes(1);
  });

  it("supports drag and drop handlers when draggable", () => {
    const handleDragStart = vi.fn();
    const handleDragOver = vi.fn();
    const handleDrop = vi.fn();
    const handleDragEnd = vi.fn();

    render(
      <EntryItem
        label="photos"
        meta="Folder"
        isDraggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
      />,
    );

    const button = screen.getByRole("button", { name: /photos/i });
    expect(button).toHaveAttribute("draggable", "true");

    fireEvent.dragStart(button);
    fireEvent.dragOver(button);
    fireEvent.drop(button);
    fireEvent.dragEnd(button);

    expect(handleDragStart).toHaveBeenCalledTimes(1);
    expect(handleDragOver).toHaveBeenCalledTimes(1);
    expect(handleDrop).toHaveBeenCalledTimes(1);
    expect(handleDragEnd).toHaveBeenCalledTimes(1);
  });

  it("applies config styling class for workspace config entries", () => {
    render(<EntryItem label=".grayspace" meta="config" isConfig />);

    const button = screen.getByRole("button", { name: /\.grayspace/i });
    expect(button.className).toMatch(/configEntry/i);
    expect(screen.getByText("config")).toBeInTheDocument();
  });

  it("renders a thumbnail image when thumbnailSrc is provided", () => {
    render(
      <EntryItem
        label="photo.png"
        meta="File"
        isFile
        thumbnailSrc="asset://localhost/photo.png"
      />,
    );

    const button = screen.getByRole("button", { name: /photo\.png/i });
    const thumbnail = button.querySelector("img");
    expect(thumbnail).toBeTruthy();
    expect(thumbnail).toHaveAttribute("src", "asset://localhost/photo.png");
  });

  it("renders a file icon when no thumbnail is available", () => {
    render(<EntryItem label="notes.rs" meta="File" isFile />);

    const button = screen.getByRole("button", { name: /notes\.rs/i });
    const icon = button.querySelector(".icon");
    expect(icon).toBeTruthy();
    expect(icon.className).toMatch(/\b[a-z0-9_-]+-icon\b/i);
  });

  it("toggles expansion without selecting the entry when clicking expander", () => {
    const handleClick = vi.fn();
    const handleToggleExpand = vi.fn();

    render(
      <EntryItem
        label="Users"
        meta="Folder"
        isDirectory
        showExpander
        onClick={handleClick}
        onToggleExpand={handleToggleExpand}
      />,
    );

    const button = screen.getByRole("button", { name: /Users/i });
    const expander = button.querySelector("[data-entry-expander]");
    expect(expander).toBeTruthy();

    fireEvent.click(expander);

    expect(handleToggleExpand).toHaveBeenCalledTimes(1);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("does not trigger row double click when double clicking expander", () => {
    const handleDoubleClick = vi.fn();

    render(
      <EntryItem
        label="Users"
        meta="Folder"
        isDirectory
        showExpander
        onDoubleClick={handleDoubleClick}
      />,
    );

    const button = screen.getByRole("button", { name: /Users/i });
    const expander = button.querySelector("[data-entry-expander]");
    expect(expander).toBeTruthy();

    fireEvent.doubleClick(expander);

    expect(handleDoubleClick).not.toHaveBeenCalled();
  });

  it("renders one indent guide per nesting level", () => {
    render(
      <EntryItem
        label="nested-file.txt"
        meta="File"
        isFile
        nestingDepth={3}
      />,
    );

    const button = screen.getByRole("button", { name: /nested-file\.txt/i });
    const guides = button.querySelectorAll("[class*='indentGuide']");
    expect(guides.length).toBe(3);
  });
});
