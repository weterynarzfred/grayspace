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
});
