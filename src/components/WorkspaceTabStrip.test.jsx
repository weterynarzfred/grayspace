import { fireEvent, render, screen } from "@testing-library/react";
import WorkspaceTabStrip from "./WorkspaceTabStrip";

vi.mock("@dnd-kit/core", () => ({
  DragOverlay: ({ children }) => <>{children}</>,
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
    onCreateWindow: vi.fn(),
    notifications: [],
    isNotificationsOpen: false,
    onToggleNotifications: vi.fn(),
    onDismissNotification: vi.fn(),
    onResolveNotificationConfirm: vi.fn(),
    ...overrides,
  };

  render(<WorkspaceTabStrip {...props} />);
  return props;
}

describe("WorkspaceTabStrip notifications", () => {
  it("toggles notifications flyout and marks the button as active when notifications exist", () => {
    const props = renderStrip({
      notifications: [
        {
          id: "n-1",
          kind: "notification",
          title: "Action failed",
          message: "Could not open file.",
          tone: "error",
        },
      ],
    });

    const notificationsButton = screen.getByRole("button", { name: "Notifications (1)" });
    expect(notificationsButton).toHaveAttribute("data-has-notifications", "true");

    fireEvent.click(notificationsButton);
    expect(props.onToggleNotifications).toHaveBeenCalledTimes(1);
  });

  it("renders multiple cards and routes notification actions", () => {
    const props = renderStrip({
      isNotificationsOpen: true,
      notifications: [
        {
          id: "n-1",
          kind: "confirm",
          title: "Delete file?",
          message: "Delete notes.txt permanently?",
          tone: "warning",
          confirmLabel: "Delete",
          cancelLabel: "Cancel",
        },
        {
          id: "n-2",
          kind: "notification",
          title: "Background task",
          message: "Build completed successfully.",
          tone: "success",
        },
      ],
    });

    expect(screen.getByText("Delete file?")).toBeInTheDocument();
    expect(screen.getByText("Background task")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onResolveNotificationConfirm).toHaveBeenCalledWith("n-1", true);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onResolveNotificationConfirm).toHaveBeenCalledWith("n-1", false);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(props.onDismissNotification).toHaveBeenCalledWith("n-2");
  });

  it("shows an empty-state message when flyout is open without notifications", () => {
    renderStrip({ isNotificationsOpen: true, notifications: [] });
    expect(screen.getByText("No notifications.")).toBeInTheDocument();
  });
});
