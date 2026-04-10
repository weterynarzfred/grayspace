import { fireEvent, render, screen } from "@testing-library/react";
import { PANEL_TYPES } from "./panelTypes";
import PanelTypeSwitcher from "./PanelTypeSwitcher";

describe("PanelTypeSwitcher", () => {
  it("opens a popover with panel rows and icons", () => {
    render(<PanelTypeSwitcher panelType="Filesystem" onPanelTypeChange={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Panel type switcher" });
    expect(trigger).toHaveTextContent("Filesystem");

    fireEvent.click(trigger);

    expect(screen.getByText("Panel Type")).toBeInTheDocument();
    PANEL_TYPES.forEach((type) => {
      expect(screen.getByRole("button", { name: type.label })).toBeInTheDocument();
    });

    const rowButtons = PANEL_TYPES.map((type) => screen.getByRole("button", { name: type.label }));
    rowButtons.forEach((button) => {
      expect(button.querySelector("img")).toBeTruthy();
    });
  });

  it("calls onPanelTypeChange when selecting a row", () => {
    const handlePanelTypeChange = vi.fn();
    render(<PanelTypeSwitcher panelType="Filesystem" onPanelTypeChange={handlePanelTypeChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Panel type switcher" }));
    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));

    expect(handlePanelTypeChange).toHaveBeenCalledWith("Terminal");
    expect(screen.queryByText("Panel Type")).not.toBeInTheDocument();
  });

  it("supports keyboard navigation and selection", () => {
    const handlePanelTypeChange = vi.fn();
    render(<PanelTypeSwitcher panelType="Filesystem" onPanelTypeChange={handlePanelTypeChange} />);

    const trigger = screen.getByRole("button", { name: "Panel type switcher" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });

    const menuTitle = screen.getByText("Panel Type");
    const menu = menuTitle.closest("div");
    expect(menu).toBeTruthy();

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "Enter" });

    expect(handlePanelTypeChange).toHaveBeenCalledWith("Terminal");
  });

  it("shows panelLabel when provided", () => {
    render(
      <PanelTypeSwitcher
        panelType="Filesystem"
        panelLabel="Filesystem (sub)"
        onPanelTypeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Panel type switcher" })).toHaveTextContent(
      "Filesystem (sub)",
    );
  });
});
