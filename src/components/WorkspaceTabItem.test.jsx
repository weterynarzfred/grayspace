import { fireEvent, render, screen } from "@testing-library/react";
import WorkspaceTabItem from "./WorkspaceTabItem";

vi.mock("@dnd-kit/core", () => ({
  useDraggable: vi.fn(() => ({
    setNodeRef: vi.fn(),
    attributes: {},
    listeners: {},
    isDragging: false,
  })),
  useDroppable: vi.fn(() => ({
    setNodeRef: vi.fn(),
    isOver: false,
  })),
}));

describe("WorkspaceTabItem", () => {
  it("closes tab on middle click", () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    render(<WorkspaceTabItem
      tab={{ tabId: "tab-1", title: "Workspace" }}
      isActive
      onActivate={onActivate}
      onClose={onClose}
    />);

    const tabButton = screen.getByRole("button", { name: "Workspace" });
    fireEvent(tabButton, new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    }));

    expect(onClose).toHaveBeenCalledWith("tab-1");
    expect(onActivate).not.toHaveBeenCalled();
  });
});
