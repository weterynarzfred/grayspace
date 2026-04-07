import { fireEvent, render, screen } from "@testing-library/react";
import RecentFoldersPopover from "./RecentFoldersPopover";

function createEntries() {
  return [
    { path: "C:\\Projects", openedAtMs: 1710806400000, isWorkspace: true },
    { path: "C:\\Users", openedAtMs: 90 },
    { path: "D:\\Archive", openedAtMs: 80 },
  ];
}

describe("RecentFoldersPopover", () => {
  it("selects the first entry on Enter by default", () => {
    const onSelect = vi.fn();
    render(<RecentFoldersPopover open entries={createEntries()} onSelect={onSelect} />);

    fireEvent.keyDown(screen.getByPlaceholderText("Search folders (coming soon)"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("C:\\Projects");
  });

  it("moves selection with arrows and runs selected entry on Enter", () => {
    const onSelect = vi.fn();
    render(<RecentFoldersPopover open entries={createEntries()} onSelect={onSelect} />);
    const input = screen.getByPlaceholderText("Search folders (coming soon)");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith("D:\\Archive");
  });

  it("shows dates as YYYY-MM-DD and marks workspace entries", () => {
    render(<RecentFoldersPopover open entries={createEntries()} />);

    expect(screen.getByText("2024-03-19")).toBeInTheDocument();
    expect(screen.getByText("C:\\Projects").className).toContain("entryPathWorkspace");
  });
});
