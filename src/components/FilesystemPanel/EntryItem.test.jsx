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
});
