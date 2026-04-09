import { fireEvent, render, screen } from "@testing-library/react";
import Breadcrumbs, { buildBreadcrumbs } from "./Breadcrumbs";

describe("Breadcrumbs", () => {
  it("renders breadcrumb items and separators", () => {
    render(<Breadcrumbs currentPath={"C:\\Users"} currentDrive={"C:\\"} onSelect={vi.fn()} />);

    expect(screen.getByRole("navigation", { name: "Current path" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drives" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /C:/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Users/i })).toBeInTheDocument();
  });

  it("calls onSelect with breadcrumb path when clicked", () => {
    const handleSelect = vi.fn();
    const driveRoot = "C:\\";

    render(<Breadcrumbs currentPath={driveRoot} currentDrive={driveRoot} onSelect={handleSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Drives" }));
    fireEvent.click(screen.getByRole("button", { name: /C:/i }));

    expect(handleSelect).toHaveBeenNthCalledWith(1, "");
    expect(handleSelect).toHaveBeenNthCalledWith(2, driveRoot);
  });

  it("builds breadcrumbs from path and drive", () => {
    expect(buildBreadcrumbs("C:\\Users\\alice\\docs", "C:\\")).toEqual([
      { label: "Drives", path: "" },
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "alice", path: "C:\\Users\\alice" },
      { label: "docs", path: "C:\\Users\\alice\\docs" },
    ]);
  });

  it("switches to path input when clicking breadcrumb row background", () => {
    render(<Breadcrumbs currentPath={"C:\\Users"} currentDrive={"C:\\"} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole("navigation", { name: "Current path" }));

    expect(screen.getByRole("textbox", { name: "Current folder path" })).toBeInTheDocument();
  });

  it("submits edited path with onPathSubmit callback", () => {
    const handlePathSubmit = vi.fn();

    render(
      <Breadcrumbs
        currentPath={"C:\\Users"}
        currentDrive={"C:\\"}
        onSelect={vi.fn()}
        onPathSubmit={handlePathSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("navigation", { name: "Current path" }));
    const pathInput = screen.getByRole("textbox", { name: "Current folder path" });
    fireEvent.change(pathInput, { target: { value: "C:\\Temp" } });
    fireEvent.submit(pathInput.closest("form"));

    expect(handlePathSubmit).toHaveBeenCalledWith("C:\\Temp");
  });

  it("submits a fallback suggestion when top suggestion differs from typed path", () => {
    const handlePathSubmit = vi.fn();

    render(
      <Breadcrumbs
        currentPath={"C:\\Users"}
        currentDrive={"C:\\"}
        onSelect={vi.fn()}
        onPathSubmit={handlePathSubmit}
        recentFoldersEntries={[
          { path: "H:\\short_lib", openedAtMs: 1710892800000, isWorkspace: true },
          { path: "C:\\Users", openedAtMs: 1710806400000, isWorkspace: false },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("navigation", { name: "Current path" }));
    const pathInput = screen.getByRole("textbox", { name: "Current folder path" });
    fireEvent.change(pathInput, { target: { value: "H:\\short" } });
    fireEvent.submit(pathInput.closest("form"));

    expect(handlePathSubmit).toHaveBeenCalledWith("H:\\short", { fallbackPath: "H:\\short_lib" });
  });

  it("collapses path input on blur when path is unchanged", () => {
    render(
      <Breadcrumbs
        currentPath={"C:\\Users"}
        currentDrive={"C:\\"}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("navigation", { name: "Current path" }));
    const pathInput = screen.getByRole("textbox", { name: "Current folder path" });
    fireEvent.blur(pathInput);

    expect(screen.queryByRole("textbox", { name: "Current folder path" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Current path" })).toBeInTheDocument();
  });

  it("keeps path input open on blur when path was changed", () => {
    render(
      <Breadcrumbs
        currentPath={"C:\\Users"}
        currentDrive={"C:\\"}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("navigation", { name: "Current path" }));
    const pathInput = screen.getByRole("textbox", { name: "Current folder path" });
    fireEvent.change(pathInput, { target: { value: "C:\\Temp" } });
    fireEvent.blur(pathInput);

    expect(screen.getByRole("textbox", { name: "Current folder path" })).toBeInTheDocument();
  });

  it("shows recent folders and selects one when clicked", () => {
    const handleRecentSelect = vi.fn();

    render(
      <Breadcrumbs
        currentPath={"C:\\Users"}
        currentDrive={"C:\\"}
        onSelect={vi.fn()}
        recentFoldersEntries={[
          { path: "C:\\Users", openedAtMs: 1710806400000, isWorkspace: false },
          { path: "D:\\Work", openedAtMs: 1710892800000, isWorkspace: true },
        ]}
        onSelectRecentFolder={handleRecentSelect}
      />,
    );

    expect(screen.queryByRole("button", { name: /D:\\Work/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("navigation", { name: "Current path" }));
    const pathInput = screen.getByRole("textbox", { name: "Current folder path" });
    fireEvent.focus(pathInput);
    fireEvent.click(screen.getByRole("button", { name: /D:\\Work/i }));

    expect(handleRecentSelect).toHaveBeenCalledWith("D:\\Work");
  });

  it("browses recent folder suggestions with arrow keys and mirrors value in input", () => {
    render(
      <Breadcrumbs
        currentPath={"C:\\Users"}
        currentDrive={"C:\\"}
        onSelect={vi.fn()}
        recentFoldersEntries={[
          { path: "C:\\Users", openedAtMs: 1710806400000, isWorkspace: false },
          { path: "D:\\Work", openedAtMs: 1710892800000, isWorkspace: true },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("navigation", { name: "Current path" }));
    const pathInput = screen.getByRole("textbox", { name: "Current folder path" });
    pathInput.focus();

    fireEvent.keyDown(pathInput, { key: "ArrowDown" });
    expect(pathInput).toHaveValue("C:\\Users");

    fireEvent.keyDown(pathInput, { key: "ArrowDown" });
    expect(pathInput).toHaveValue("D:\\Work");

    fireEvent.keyDown(pathInput, { key: "ArrowUp" });
    expect(pathInput).toHaveValue("C:\\Users");
  });

  it("filters recent folder suggestions based on typed query", () => {
    render(
      <Breadcrumbs
        currentPath={"C:\\Users"}
        currentDrive={"C:\\"}
        onSelect={vi.fn()}
        recentFoldersEntries={[
          { path: "C:\\Users", openedAtMs: 1710806400000, isWorkspace: false },
          { path: "D:\\Work", openedAtMs: 1710892800000, isWorkspace: true },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("navigation", { name: "Current path" }));
    const pathInput = screen.getByRole("textbox", { name: "Current folder path" });
    pathInput.focus();
    fireEvent.change(pathInput, { target: { value: "work" } });

    expect(screen.getByRole("button", { name: /D:\\Work/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /C:\\Users/i })).not.toBeInTheDocument();
  });
});
