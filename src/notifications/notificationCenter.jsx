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
const DEFAULT_POPOVER_POSITION = { x: 8, y: 8 };

let notificationCounter = 0;

function createNotificationId() {
  notificationCounter += 1;
  return `notification-${Date.now()}-${notificationCounter}`;
}

function resolveNotificationTone(tone) {
  if (tone === "success" || tone === "warning" || tone === "error") return tone;
  return "info";
}

function resolvePopoverPosition(position, fallbackPosition) {
  const fallbackX = Number.isFinite(fallbackPosition?.x)
    ? fallbackPosition.x
    : DEFAULT_POPOVER_POSITION.x;
  const fallbackY = Number.isFinite(fallbackPosition?.y)
    ? fallbackPosition.y
    : DEFAULT_POPOVER_POSITION.y;
  const x = Number.isFinite(position?.x) ? position.x : fallbackX;
  const y = Number.isFinite(position?.y) ? position.y : fallbackY;
  return { x, y };
}

function resolveConfirmDefaultAction(defaultAction) {
  if (typeof defaultAction === "boolean") return defaultAction;
  return false;
}

export function NotificationCenterProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const confirmResolversRef = useRef(new Map());
  const lastPointerPositionRef = useRef(DEFAULT_POPOVER_POSITION);

  useEffect(() => {
    const updatePointerPosition = (event) => {
      const nextX = Number.isFinite(event?.clientX)
        ? event.clientX
        : DEFAULT_POPOVER_POSITION.x;
      const nextY = Number.isFinite(event?.clientY)
        ? event.clientY
        : DEFAULT_POPOVER_POSITION.y;
      lastPointerPositionRef.current = { x: nextX, y: nextY };
    };

    window.addEventListener("pointermove", updatePointerPosition, true);
    window.addEventListener("pointerdown", updatePointerPosition, true);
    return () => {
      window.removeEventListener("pointermove", updatePointerPosition, true);
      window.removeEventListener("pointerdown", updatePointerPosition, true);
    };
  }, []);

  const removeNotification = useCallback((notificationId) => {
    setNotifications(previousNotifications =>
      previousNotifications.filter(entry => entry.id !== notificationId));
  }, []);

  useEffect(() => () => {
    confirmResolversRef.current.forEach(({ resolve, defaultAction }) => {
      resolve(defaultAction);
    });
    confirmResolversRef.current.clear();
  }, []);

  const dismissNotification = useCallback((notificationId) => {
    removeNotification(notificationId);

    const resolver = confirmResolversRef.current.get(notificationId);
    if (resolver) {
      resolver.resolve(false);
      confirmResolversRef.current.delete(notificationId);
    }
  }, [removeNotification]);

  const closeNotificationWithDefault = useCallback((notificationId) => {
    const resolver = confirmResolversRef.current.get(notificationId);
    if (resolver) {
      resolver.resolve(resolver.defaultAction);
      confirmResolversRef.current.delete(notificationId);
    }

    removeNotification(notificationId);
  }, [removeNotification]);

  const resolveConfirmNotification = useCallback((notificationId, confirmed) => {
    const resolver = confirmResolversRef.current.get(notificationId);
    if (resolver) {
      resolver.resolve(Boolean(confirmed));
      confirmResolversRef.current.delete(notificationId);
    }

    removeNotification(notificationId);
  }, [removeNotification]);

  const pushNotification = useCallback((options = {}) => {
    const notificationId = createNotificationId();
    const notification = {
      id: notificationId,
      kind: "notification",
      title: typeof options.title === "string" ? options.title : "Notification",
      message: typeof options.message === "string" ? options.message : "",
      tone: resolveNotificationTone(options.tone),
      position: resolvePopoverPosition(options.position, lastPointerPositionRef.current),
      dismissOnOutside: options.dismissOnOutside !== false,
    };

    setNotifications(previousNotifications => [...previousNotifications, notification]);
    return notificationId;
  }, []);

  const openConfirm = useCallback((options = {}) => new Promise((resolve) => {
    const notificationId = createNotificationId();
    const defaultAction = resolveConfirmDefaultAction(options.defaultAction);
    const confirmNotification = {
      id: notificationId,
      kind: "confirm",
      title: typeof options.title === "string" && options.title
        ? options.title
        : "Please confirm",
      message: typeof options.message === "string" ? options.message : "",
      tone: resolveNotificationTone(options.tone),
      confirmLabel: typeof options.confirmLabel === "string" && options.confirmLabel
        ? options.confirmLabel
        : "Confirm",
      cancelLabel: typeof options.cancelLabel === "string" && options.cancelLabel
        ? options.cancelLabel
        : "Cancel",
      position: resolvePopoverPosition(options.position, lastPointerPositionRef.current),
      dismissOnOutside: options.dismissOnOutside !== false,
      defaultAction,
    };

    confirmResolversRef.current.set(notificationId, { resolve, defaultAction });
    setNotifications(previousNotifications => [...previousNotifications, confirmNotification]);
  }), []);

  const activeNotification = notifications[0] ?? null;

  const value = useMemo(() => ({
    activeNotification,
    pushNotification,
    openConfirm,
    dismissNotification,
    closeNotificationWithDefault,
    resolveConfirmNotification,
  }), [
    activeNotification,
    closeNotificationWithDefault,
    dismissNotification,
    openConfirm,
    pushNotification,
    resolveConfirmNotification,
  ]);

  return <NotificationCenterContext.Provider value={value}>
    {children}
  </NotificationCenterContext.Provider>;
}

export function useNotificationCenter() {
  const context = useContext(NotificationCenterContext);
  if (!context)
    throw new Error("useNotificationCenter must be used within NotificationCenterProvider.");

  return context;
}
