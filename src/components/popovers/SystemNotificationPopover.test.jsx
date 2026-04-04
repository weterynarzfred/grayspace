import { fireEvent, render, screen } from "@testing-library/react";
import SystemNotificationPopover from "./SystemNotificationPopover";

function createNotification(overrides = {}) {
  return {
    id: "n-1",
    kind: "notification",
    title: "Notice",
    message: "Something happened.",
    tone: "info",
    position: { x: 24, y: 24 },
    dismissOnOutside: true,
    ...overrides,
  };
}

describe("SystemNotificationPopover", () => {
  it("renders confirm actions and routes button callbacks", () => {
    const onResolveConfirm = vi.fn();
    const notification = createNotification({
      kind: "confirm",
      title: "Delete file?",
      cancelLabel: "Keep",
      confirmLabel: "Delete",
    });

    render(<SystemNotificationPopover
      open
      notification={notification}
      onResolveConfirm={onResolveConfirm}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(onResolveConfirm).toHaveBeenCalledWith("n-1", false);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onResolveConfirm).toHaveBeenCalledWith("n-1", true);
  });

  it("routes dismiss action for regular notifications", () => {
    const onDismiss = vi.fn();
    const notification = createNotification();

    render(<SystemNotificationPopover
      open
      notification={notification}
      onDismiss={onDismiss}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith("n-1");
  });

  it("uses default close callback on outside click when dismissOnOutside is enabled", () => {
    const onCloseWithDefault = vi.fn();
    const notification = createNotification({ kind: "confirm" });

    render(<SystemNotificationPopover
      open
      notification={notification}
      onCloseWithDefault={onCloseWithDefault}
    />);

    fireEvent.pointerDown(document.body);
    expect(onCloseWithDefault).toHaveBeenCalledWith("n-1");
  });

  it("ignores outside close when dismissOnOutside is disabled", () => {
    const onCloseWithDefault = vi.fn();
    const notification = createNotification({
      kind: "confirm",
      dismissOnOutside: false,
    });

    render(<SystemNotificationPopover
      open
      notification={notification}
      onCloseWithDefault={onCloseWithDefault}
    />);

    fireEvent.pointerDown(document.body);
    expect(onCloseWithDefault).not.toHaveBeenCalled();
  });
});
