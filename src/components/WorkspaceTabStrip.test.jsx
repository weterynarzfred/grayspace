import { fireEvent, render, screen } from "@testing-library/react";
import WorkspaceTabStrip from "./WorkspaceTabStrip";

const { closeMock, minimizeMock, toggleMaximizeMock } = vi.hoisted(() => ({
  closeMock: vi.fn(),
  minimizeMock: vi.fn(),
  toggleMaximizeMock: vi.fn(),
}));

vi.mock("@dnd-kit/core", () => ({
  DragOverlay: ({ children }) => <>{children}</>,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: minimizeMock,
    toggleMaximize: toggleMaximizeMock,
    close: closeMock,
  }),
}));

vi.mock("./WorkspaceTabItem", () => ({
  default: ({ tab }) => <div>{tab.title}</div>,
}));

function renderStrip(overrides = {}) {
  const props = {
    tabs: [
      { tabId: "tab-1", title: "Tab 1" },
      { tabId: "tab-2", title: "Tab 2" },
    ],
    activeTabId: "tab-1",
    activeDragTabId: "",
    onActivateTab: vi.fn(),
    onCloseTab: vi.fn(),
    onCreateTab: vi.fn(),
    ...overrides,
  };

  render(<WorkspaceTabStrip {...props} />);
  return props;
}

describe("WorkspaceTabStrip", () => {
  beforeEach(() => {
    minimizeMock.mockReset();
    toggleMaximizeMock.mockReset();
    closeMock.mockReset();
  });

  it("renders tabs and create-tab button", () => {
    const props = renderStrip();
    expect(screen.getByText("Tab 1")).toBeInTheDocument();
    expect(screen.getByText("Tab 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+" }));
    expect(props.onCreateTab).toHaveBeenCalledTimes(1);
  });

  it("does not render notifications controls", () => {
    renderStrip();
    expect(screen.queryByRole("button", { name: /Notifications/i })).not.toBeInTheDocument();
    expect(screen.queryByText("No notifications.")).not.toBeInTheDocument();
  });

  it("renders custom window control buttons", () => {
    renderStrip();
    fireEvent.click(screen.getByRole("button", { name: "Minimize window" }));
    expect(minimizeMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Maximize window" }));
    expect(toggleMaximizeMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close window" }));
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
