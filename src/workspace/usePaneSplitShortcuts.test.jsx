import { render } from "@testing-library/react";
import { COMMAND_IDS } from "../commands/commandRegistry";
import usePaneSplitShortcuts from "./usePaneSplitShortcuts";

function HookHarness({ onShortcutCommand }) {
  usePaneSplitShortcuts(onShortcutCommand);
  return <input data-testid="editable-target" />;
}

function dispatchShortcutEvent(target, keyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...keyboardEventInit,
  });
  target.dispatchEvent(event);
  return event;
}

describe("usePaneSplitShortcuts", () => {
  it("dispatches vertical split command for Alt+V", () => {
    const onShortcutCommand = vi.fn();
    render(<HookHarness onShortcutCommand={onShortcutCommand} />);

    const event = dispatchShortcutEvent(window, {
      key: "v",
      altKey: true,
    });

    expect(event.defaultPrevented).toBe(true);
    expect(onShortcutCommand).toHaveBeenCalledTimes(1);
    expect(onShortcutCommand).toHaveBeenCalledWith(
      COMMAND_IDS.PANE_SPLIT_VERTICAL,
      { source: "shortcut" },
    );
  });

  it("dispatches horizontal split command for Alt+H", () => {
    const onShortcutCommand = vi.fn();
    render(<HookHarness onShortcutCommand={onShortcutCommand} />);

    dispatchShortcutEvent(window, {
      key: "h",
      altKey: true,
    });

    expect(onShortcutCommand).toHaveBeenCalledWith(
      COMMAND_IDS.PANE_SPLIT_HORIZONTAL,
      { source: "shortcut" },
    );
  });

  it("ignores events that are repeated or already prevented", () => {
    const onShortcutCommand = vi.fn();
    render(<HookHarness onShortcutCommand={onShortcutCommand} />);

    dispatchShortcutEvent(window, {
      key: "v",
      altKey: true,
      repeat: true,
    });

    const preventedEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "v",
      altKey: true,
    });
    preventedEvent.preventDefault();
    window.dispatchEvent(preventedEvent);

    expect(onShortcutCommand).not.toHaveBeenCalled();
  });

  it("ignores split shortcuts from editable targets", () => {
    const onShortcutCommand = vi.fn();
    const { getByTestId } = render(<HookHarness onShortcutCommand={onShortcutCommand} />);

    dispatchShortcutEvent(getByTestId("editable-target"), {
      key: "v",
      altKey: true,
    });

    expect(onShortcutCommand).not.toHaveBeenCalled();
  });

  it("removes keydown listener when unmounted", () => {
    const onShortcutCommand = vi.fn();
    const { unmount } = render(<HookHarness onShortcutCommand={onShortcutCommand} />);
    unmount();

    dispatchShortcutEvent(window, {
      key: "v",
      altKey: true,
    });

    expect(onShortcutCommand).not.toHaveBeenCalled();
  });
});
