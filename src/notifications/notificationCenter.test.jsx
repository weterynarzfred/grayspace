import { act, renderHook, waitFor } from "@testing-library/react";
import {
  NotificationCenterProvider,
  useNotificationCenter,
} from "./notificationCenter";

function NotificationCenterWrapper({ children }) {
  return <NotificationCenterProvider>{children}</NotificationCenterProvider>;
}

describe("notificationCenter", () => {
  it("queues notifications and toggles flyout visibility", () => {
    const { result } = renderHook(() => useNotificationCenter(), {
      wrapper: NotificationCenterWrapper,
    });

    expect(result.current.notifications).toEqual([]);
    expect(result.current.isNotificationsOpen).toBe(false);

    act(() => {
      result.current.pushNotification({
        title: "Build complete",
        message: "Done.",
        tone: "success",
      });
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.isNotificationsOpen).toBe(false);

    act(() => {
      result.current.toggleNotifications();
    });
    expect(result.current.isNotificationsOpen).toBe(true);
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
      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.isNotificationsOpen).toBe(true);
    });

    const [confirmItem] = result.current.notifications;
    let confirmResult = null;
    await act(async () => {
      result.current.resolveConfirmNotification(confirmItem.id, true);
      confirmResult = await confirmPromise;
    });
    expect(confirmResult).toBe(true);
    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.isNotificationsOpen).toBe(false);

    let dismissPromise;
    act(() => {
      dismissPromise = result.current.openConfirm({
        title: "Close tab?",
        autoOpen: false,
      });
    });

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1);
    });

    const [dismissItem] = result.current.notifications;
    let dismissResult = null;
    await act(async () => {
      result.current.dismissNotification(dismissItem.id);
      dismissResult = await dismissPromise;
    });
    expect(dismissResult).toBe(false);
    expect(result.current.notifications).toHaveLength(0);
    expect(result.current.isNotificationsOpen).toBe(false);
  });

  it("auto-closes the flyout when the last notification is dismissed", async () => {
    const { result } = renderHook(() => useNotificationCenter(), {
      wrapper: NotificationCenterWrapper,
    });

    let notificationId = "";
    act(() => {
      notificationId = result.current.pushNotification({
        title: "Action failed",
        message: "Something went wrong.",
        tone: "error",
        autoOpen: true,
      });
    });

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.isNotificationsOpen).toBe(true);
    });

    act(() => {
      result.current.dismissNotification(notificationId);
    });

    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(0);
      expect(result.current.isNotificationsOpen).toBe(false);
    });
  });
});
