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
    });
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
