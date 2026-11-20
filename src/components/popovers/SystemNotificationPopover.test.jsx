import { act, fireEvent, render, screen } from "@testing-library/react";
import SystemNotificationPopover from "./SystemNotificationPopover";

// The popover takes the focus a frame after it opens.
async function waitForNextFrame() {
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

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

  it("executes the default confirm action on Enter", () => {
    const onResolveConfirm = vi.fn();
    const notification = createNotification({
      kind: "confirm",
      defaultAction: true,
    });

    render(<SystemNotificationPopover
      open
      notification={notification}
      onResolveConfirm={onResolveConfirm}
    />);

    fireEvent.keyDown(screen.getByTestId("system-notification-root"), { key: "Enter" });
    expect(onResolveConfirm).toHaveBeenCalledWith("n-1", true);
  });

  it("changes selected confirm action with arrows and executes on Enter", () => {
    const onResolveConfirm = vi.fn();
    const notification = createNotification({
      kind: "confirm",
      defaultAction: false,
    });

    render(<SystemNotificationPopover
      open
      notification={notification}
      onResolveConfirm={onResolveConfirm}
    />);

    const root = screen.getByTestId("system-notification-root");
    fireEvent.keyDown(root, { key: "ArrowRight" });
    fireEvent.keyDown(root, { key: "Enter" });
    expect(onResolveConfirm).toHaveBeenCalledWith("n-1", true);
  });

  it("takes the focus when it opens, so Enter picks the preselected choice", async () => {
    const onResolveConfirm = vi.fn();
    render(<SystemNotificationPopover
      open
      notification={createNotification({ kind: "choice", choices: [{ id: "replace", label: "Replace" }] })}
      onResolveConfirm={onResolveConfirm}
    />);

    await waitForNextFrame();
    const root = screen.getByTestId("system-notification-root");
    expect(root).toHaveFocus();
    fireEvent.keyDown(root, { key: "Enter" });
    expect(onResolveConfirm).toHaveBeenCalledWith("n-1", "replace");
  });

  it("leaves focus where it is for takeFocus false, so Enter doesn't pick a choice", async () => {
    const onResolveConfirm = vi.fn();
    render(<input aria-label="Rename" />);
    const renameInput = screen.getByRole("textbox", { name: "Rename" });
    renameInput.focus();

    render(<SystemNotificationPopover
      open
      notification={createNotification({
        kind: "choice",
        choices: [{ id: "replace", label: "Replace" }],
        takeFocus: false,
        dismissOnOutside: false,
      })}
      onResolveConfirm={onResolveConfirm}
    />);
    await waitForNextFrame();

    expect(renameInput).toHaveFocus();
    fireEvent.keyDown(renameInput, { key: "Enter" });
    expect(onResolveConfirm).not.toHaveBeenCalled();
  });

  it("is not cancelled by Escape when dismissOnOutside is disabled", () => {
    const onCloseWithDefault = vi.fn();
    render(<SystemNotificationPopover
      open
      notification={createNotification({ kind: "choice", choices: [], dismissOnOutside: false })}
      onCloseWithDefault={onCloseWithDefault}
    />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCloseWithDefault).not.toHaveBeenCalled();
  });

  it("renders choice actions and resolves with the picked id or null", () => {
    const onResolveConfirm = vi.fn();
    const notification = createNotification({
      kind: "choice",
      title: "Item already exists",
      cancelLabel: "Cancel",
      choices: [
        { id: "replace", label: "Replace" },
        { id: "keep-both", label: "Keep both" },
      ],
    });

    render(<SystemNotificationPopover
      open
      notification={notification}
      onResolveConfirm={onResolveConfirm}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Keep both" }));
    expect(onResolveConfirm).toHaveBeenCalledWith("n-1", "keep-both");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResolveConfirm).toHaveBeenCalledWith("n-1", null);
  });
});
