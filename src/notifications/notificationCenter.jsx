import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const NotificationCenterContext = createContext(null);

let notificationCounter = 0;

function createNotificationId() {
  notificationCounter += 1;
  return `notification-${Date.now()}-${notificationCounter}`;
}

function resolveNotificationTone(tone) {
  if (tone === "success" || tone === "warning" || tone === "error") return tone;
  return "info";
}

export function NotificationCenterProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationResolversRef = useRef(new Map());
  const notificationsRef = useRef([]);
  const previousNotificationCountRef = useRef(0);

  notificationsRef.current = notifications;

  useEffect(() => {
    const previousCount = previousNotificationCountRef.current;
    if (previousCount > 0 && notifications.length === 0) {
      setIsNotificationsOpen(false);
    }
    previousNotificationCountRef.current = notifications.length;
  }, [notifications.length]);

  useEffect(() => () => {
    notificationResolversRef.current.forEach((resolveNotification) => {
      try {
        resolveNotification(false);
      } catch {
        // ignore resolver errors during shutdown
      }
    });
    notificationResolversRef.current.clear();
  }, []);

  const dismissNotification = useCallback((notificationId) => {
    const notification = notificationsRef.current.find(
      (entry) => entry.id === notificationId,
    );

    setNotifications((previousNotifications) => (
      previousNotifications.filter((entry) => entry.id !== notificationId)
    ));

    if (notification?.kind === "confirm") {
      const resolver = notificationResolversRef.current.get(notificationId);
      if (resolver) {
        resolver(false);
        notificationResolversRef.current.delete(notificationId);
      }
    }
  }, []);

  const resolveConfirmNotification = useCallback((notificationId, confirmed) => {
    const resolver = notificationResolversRef.current.get(notificationId);
    if (resolver) {
      resolver(Boolean(confirmed));
      notificationResolversRef.current.delete(notificationId);
    }

    setNotifications((previousNotifications) => (
      previousNotifications.filter((entry) => entry.id !== notificationId)
    ));
  }, []);

  const pushNotification = useCallback((options = {}) => {
    const notificationId = createNotificationId();
    const notification = {
      id: notificationId,
      kind: "notification",
      title: typeof options.title === "string" ? options.title : "Notification",
      message: typeof options.message === "string" ? options.message : "",
      tone: resolveNotificationTone(options.tone),
      autoOpen: Boolean(options.autoOpen),
    };

    setNotifications((previousNotifications) => [notification, ...previousNotifications]);
    if (notification.autoOpen) setIsNotificationsOpen(true);
    return notificationId;
  }, []);

  const openConfirm = useCallback((options = {}) => new Promise((resolve) => {
    const notificationId = createNotificationId();
    const confirmNotification = {
      id: notificationId,
      kind: "confirm",
      title: typeof options.title === "string" && options.title
        ? options.title
        : "Please confirm",
      message: typeof options.message === "string" ? options.message : "",
      tone: resolveNotificationTone(options.tone),
      autoOpen: options.autoOpen !== false,
      confirmLabel: typeof options.confirmLabel === "string" && options.confirmLabel
        ? options.confirmLabel
        : "Confirm",
      cancelLabel: typeof options.cancelLabel === "string" && options.cancelLabel
        ? options.cancelLabel
        : "Cancel",
    };

    notificationResolversRef.current.set(notificationId, resolve);
    setNotifications((previousNotifications) => [confirmNotification, ...previousNotifications]);
    if (confirmNotification.autoOpen) setIsNotificationsOpen(true);
  }), []);

  const toggleNotifications = useCallback(() => {
    setIsNotificationsOpen((open) => !open);
  }, []);

  const value = useMemo(() => ({
    notifications,
    isNotificationsOpen,
    pushNotification,
    openConfirm,
    toggleNotifications,
    dismissNotification,
    resolveConfirmNotification,
  }), [
    dismissNotification,
    isNotificationsOpen,
    notifications,
    openConfirm,
    pushNotification,
    resolveConfirmNotification,
    toggleNotifications,
  ]);

  return (
    <NotificationCenterContext.Provider value={value}>
      {children}
    </NotificationCenterContext.Provider>
  );
}

export function useNotificationCenter() {
  const context = useContext(NotificationCenterContext);
  if (!context)
    throw new Error("useNotificationCenter must be used within NotificationCenterProvider.");

  return context;
}
