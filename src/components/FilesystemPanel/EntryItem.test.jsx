import { fireEvent, render, screen } from "@testing-library/react";
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
});
