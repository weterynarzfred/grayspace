import { act, renderHook, waitFor } from "@testing-library/react";
import {
  NotificationCenterProvider,
  useNotificationCenter,
} from "./notificationCenter";

function NotificationCenterWrapper({ children }) {
  return <NotificationCenterProvider>{children}</NotificationCenterProvider>;
}

describe("notificationCenter", () => {
  it("queues notifications in FIFO order", () => {
    const { result } = renderHook(() => useNotificationCenter(), {
      wrapper: NotificationCenterWrapper,
    });

    expect(result.current.activeNotification).toBeNull();

    act(() => {
      result.current.pushNotification({
        title: "First",
      });
      result.current.pushNotification({ title: "Second" });
    });

    expect(result.current.activeNotification?.title).toBe("First");

    act(() => {
      const activeId = result.current.activeNotification?.id ?? "";
      result.current.dismissNotification(activeId);
    });
    expect(result.current.activeNotification?.title).toBe("Second");

    act(() => {
      const activeId = result.current.activeNotification?.id ?? "";
      result.current.dismissNotification(activeId);
    });
    expect(result.current.activeNotification).toBeNull();
  });

  it("applies default notification fields", () => {
    const { result } = renderHook(() => useNotificationCenter(), {
      wrapper: NotificationCenterWrapper,
    });

    let notificationId = "";
    act(() => {
      notificationId = result.current.pushNotification({
        title: "Build complete",
        message: "Done.",
        tone: "success",
      });
    });

    expect(result.current.activeNotification).toMatchObject({
      id: notificationId,
      kind: "notification",
      title: "Build complete",
      message: "Done.",
      tone: "success",
      position: { x: 8, y: 8 },
      dismissOnOutside: true,
      takeFocus: true,
    });
  });

  it("lets notifications and choices leave the focus alone", () => {
    const { result } = renderHook(() => useNotificationCenter(), {
      wrapper: NotificationCenterWrapper,
    });
    const dismissActive = () => act(() => {
      result.current.dismissNotification(result.current.activeNotification.id);
    });

    act(() => {
      result.current.pushNotification({ title: "Copy failed", tone: "error", takeFocus: false });
      result.current.openChoice({ title: "Item already exists", choices: [], takeFocus: false });
      result.current.openChoice({ title: "2 items already exist", choices: [] });
    });

    expect(result.current.activeNotification).toMatchObject({ title: "Copy failed", takeFocus: false });
    dismissActive();
    expect(result.current.activeNotification).toMatchObject({ title: "Item already exists", takeFocus: false });
    dismissActive();
    expect(result.current.activeNotification).toMatchObject({ title: "2 items already exist", takeFocus: true });
  });

  it("withdraws a choice when its signal aborts: it leaves the queue and resolves with null", async () => {
    const { result } = renderHook(() => useNotificationCenter(), {
      wrapper: NotificationCenterWrapper,
    });
    const abortController = new AbortController();

    let choicePromise;
    act(() => {
      choicePromise = result.current.openChoice({
        title: "Item already exists",
        choices: [{ id: "replace", label: "Replace" }],
        signal: abortController.signal,
      });
      result.current.pushNotification({ title: "Copy failed" });
    });
    expect(result.current.activeNotification?.title).toBe("Item already exists");

    act(() => abortController.abort());

    expect(result.current.activeNotification?.title).toBe("Copy failed");
    expect(await choicePromise).toBeNull();
  });

  it("resolves confirm notifications on confirm and dismiss actions", async () => {
    const { result } = renderHook(() => useNotificationCenter(), {
      wrapper: NotificationCenterWrapper,
    });

    let confirmPromise;
    act(() => {
      confirmPromise = result.current.openConfirm({
        title: "Delete file?",
      });
    });

    await waitFor(() => {
      expect(result.current.activeNotification?.kind).toBe("confirm");
    });

    const confirmId = result.current.activeNotification?.id ?? "";
    let confirmResult = null;
    await act(async () => {
      result.current.resolveConfirmNotification(confirmId, true);
      confirmResult = await confirmPromise;
    });
    expect(confirmResult).toBe(true);
    expect(result.current.activeNotification).toBeNull();

    let dismissPromise;
    act(() => {
      dismissPromise = result.current.openConfirm({
        title: "Close tab?",
      });
    });

    await waitFor(() => {
      expect(result.current.activeNotification?.kind).toBe("confirm");
    });

    const dismissId = result.current.activeNotification?.id ?? "";
    let dismissResult = null;
    await act(async () => {
      result.current.dismissNotification(dismissId);
      dismissResult = await dismissPromise;
    });
    expect(dismissResult).toBe(false);
    expect(result.current.activeNotification).toBeNull();
  });

  it("resolves active confirm with default action when closed implicitly", async () => {
    const { result } = renderHook(() => useNotificationCenter(), {
      wrapper: NotificationCenterWrapper,
    });

    let defaultFalsePromise;
    act(() => {
      defaultFalsePromise = result.current.openConfirm({
        title: "Close tab?",
      });
    });

    let defaultFalseResult = null;
    await act(async () => {
      const notificationId = result.current.activeNotification?.id ?? "";
      result.current.closeNotificationWithDefault(notificationId);
      defaultFalseResult = await defaultFalsePromise;
    });
    expect(defaultFalseResult).toBe(false);

    let defaultTruePromise;
    act(() => {
      defaultTruePromise = result.current.openConfirm({
        title: "Apply defaults?",
        defaultAction: true,
      });
    });

    let defaultTrueResult = null;
    await act(async () => {
      const notificationId = result.current.activeNotification?.id ?? "";
      result.current.closeNotificationWithDefault(notificationId);
      defaultTrueResult = await defaultTruePromise;
    });
    expect(defaultTrueResult).toBe(true);
  });
});
