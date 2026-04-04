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

  const handleClose = () => {
    if (notification.dismissOnOutside === false) return;
    onCloseWithDefault?.(notification.id);
  };

  return <FloatingPopover
    open={open}
    position={notification.position}
    onClose={handleClose}
    className={`${styles.popover} ${getToneClassName(notification.tone)}`}
  >
    <h2 className={styles.title}>{notification.title || "Notification"}</h2>
    {notification.message ? <p className={styles.message}>{notification.message}</p> : null}
    {notification.kind === "confirm" ? <div className={styles.actions}>
      <button
        type="button"
        className={styles.actionButton}
        onClick={() => onResolveConfirm?.(notification.id, false)}
      >
        {notification.cancelLabel || "Cancel"}
      </button>
      <button
        type="button"
        className={styles.actionButton}
        onClick={() => onResolveConfirm?.(notification.id, true)}
      >
        {notification.confirmLabel || "Confirm"}
      </button>
    </div> : <div className={styles.actions}>
      <button
        type="button"
        className={styles.actionButton}
        onClick={() => onDismiss?.(notification.id)}
      >
        Dismiss
      </button>
    </div>}
  </FloatingPopover>;
}

export default SystemNotificationPopover;
