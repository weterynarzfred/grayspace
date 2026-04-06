import { useEffect, useMemo, useRef, useState } from "react";
import FloatingPopover from "./FloatingPopover";
import styles from "./SystemNotificationPopover.module.scss";

function getToneClassName(tone) {
  if (tone === "error") return styles.toneError;
  if (tone === "warning") return styles.toneWarning;
  if (tone === "success") return styles.toneSuccess;
  return styles.toneInfo;
}

function SystemNotificationPopover({
  open = false,
  notification = null,
  onDismiss = undefined,
  onResolveConfirm = undefined,
  onCloseWithDefault = undefined,
}) {
  if (!notification) return null;
  const rootRef = useRef(null);
  const actions = useMemo(() => {
    if (notification.kind === "confirm") {
      return [
        {
          id: "cancel",
          label: notification.cancelLabel || "Cancel",
          execute: () => onResolveConfirm?.(notification.id, false),
        },
        {
          id: "confirm",
          label: notification.confirmLabel || "Confirm",
          execute: () => onResolveConfirm?.(notification.id, true),
        },
      ];
    }

    return [{
      id: "dismiss",
      label: "Dismiss",
      execute: () => onDismiss?.(notification.id),
    }];
  }, [notification, onDismiss, onResolveConfirm]);
  const defaultActionIndex = useMemo(() => {
    if (notification.kind !== "confirm") return 0;
    return notification.defaultAction ? 1 : 0;
  }, [notification.defaultAction, notification.kind]);
  const [selectedActionIndex, setSelectedActionIndex] = useState(defaultActionIndex);

  const handleClose = () => {
    if (notification.dismissOnOutside === false) return;
    onCloseWithDefault?.(notification.id);
  };

  useEffect(() => {
    if (!open) return;
    setSelectedActionIndex(defaultActionIndex);
    requestAnimationFrame(() => rootRef.current?.focus());
  }, [defaultActionIndex, open, notification.id]);

  useEffect(() => {
    if (!open) return;
    setSelectedActionIndex((current) => {
      if (actions.length === 0) return -1;
      if (current < 0) return defaultActionIndex;
      return Math.min(current, actions.length - 1);
    });
  }, [actions.length, defaultActionIndex, open]);

  const handleKeyDown = (event) => {
    if (actions.length === 0) return;

    const isForwardArrow = event.key === "ArrowDown" || event.key === "ArrowRight";
    if (isForwardArrow) {
      event.preventDefault();
      setSelectedActionIndex((current) => (
        current < 0 ? defaultActionIndex : (current + 1) % actions.length
      ));
      return;
    }

    const isBackwardArrow = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (isBackwardArrow) {
      event.preventDefault();
      setSelectedActionIndex((current) => (
        current < 0
          ? defaultActionIndex
          : (current - 1 + actions.length) % actions.length
      ));
      return;
    }

    if (event.key !== "Enter") return;
    event.preventDefault();
    const selectedAction = actions[selectedActionIndex >= 0 ? selectedActionIndex : defaultActionIndex];
    selectedAction?.execute?.();
  };

  return <FloatingPopover
    open={open}
    position={notification.position}
    onClose={handleClose}
    className={`${styles.popover} ${getToneClassName(notification.tone)}`}
  >
    <div
      ref={rootRef}
      data-testid="system-notification-root"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <h2 className={styles.title}>{notification.title || "Notification"}</h2>
      {notification.message ? <p className={styles.message}>{notification.message}</p> : null}
      <div className={styles.actions}>
        {actions.map((action, index) => <button
          key={action.id}
          type="button"
          className={`${styles.actionButton} ${selectedActionIndex === index ? styles.actionButtonSelected : ""}`.trim()}
          onMouseEnter={() => setSelectedActionIndex(index)}
          onClick={action.execute}
        >
          {action.label}
        </button>)}
      </div>
    </div>
  </FloatingPopover>;
}

export default SystemNotificationPopover;
