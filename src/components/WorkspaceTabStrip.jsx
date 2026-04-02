import { DragOverlay } from "@dnd-kit/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import appIcon from "../../src-tauri/icons/icon.svg";
import WorkspaceTabItem from "./WorkspaceTabItem";
import styles from "./WorkspaceTabStrip.module.scss";

function getNotificationToneClassName(tone) {
  if (tone === "error") return styles.notificationToneError;
  if (tone === "warning") return styles.notificationToneWarning;
  if (tone === "success") return styles.notificationToneSuccess;
  return styles.notificationToneInfo;
}

function WorkspaceTabStrip({
  tabs,
  activeTabId,
  activeDragTabId,
  onActivateTab,
  onCloseTab,
  onCreateTab,
  notifications = [],
  isNotificationsOpen = false,
  onToggleNotifications = undefined,
  onDismissNotification = undefined,
  onResolveNotificationConfirm = undefined,
}) {
  const handleMinimizeWindow = () => {
    void getCurrentWindow().minimize();
  };
  const handleToggleMaximizeWindow = () => {
    void getCurrentWindow().toggleMaximize();
  };
  const handleCloseWindow = () => {
    void getCurrentWindow().close();
  };
  const activeTabTitle = tabs.find(tab => tab.tabId === activeDragTabId)?.title ?? "";
  const hasNotifications = notifications.length > 0;
  const notificationsButtonClassName = `${styles.notificationsButton} ${hasNotifications ? styles.notificationsButtonAlert : ""}`;
  const renderNotificationActions = (notification) => {
    if (notification.kind !== "confirm") {
      return <div className={styles.notificationActions}>
        <button
          type="button"
          className={styles.notificationActionButton}
          onClick={() => onDismissNotification?.(notification.id)}
        >
          Dismiss
        </button>
      </div>;
    }

    return <div className={styles.notificationActions}>
      <button
        type="button"
        className={styles.notificationActionButton}
        onClick={() => onResolveNotificationConfirm?.(notification.id, false)}
      >
        {notification.cancelLabel || "Cancel"}
      </button>
      <button
        type="button"
        className={styles.notificationActionButton}
        onClick={() => onResolveNotificationConfirm?.(notification.id, true)}
      >
        {notification.confirmLabel || "Confirm"}
      </button>
    </div>;
  };

  return <header className={styles.tabStrip}>
    <div
      className={styles.dragRegion}
      data-tauri-drag-region
      aria-hidden
    >
      <img
        src={appIcon}
        alt=""
        className={styles.dragRegionIcon}
        draggable={false}
      />
    </div>
    <div className={styles.tabList}>
      {tabs.map(tab => <WorkspaceTabItem
        key={tab.tabId}
        tab={tab}
        isActive={tab.tabId === activeTabId}
        onActivate={onActivateTab}
        onClose={onCloseTab}
      />)}
    </div>
    <div className={styles.tabActions}>
      <button type="button" className={styles.actionButton} onClick={onCreateTab}>
        +
      </button>
    </div>
    <div
      className={styles.tabSpacer}
      data-tauri-drag-region
      aria-hidden
    />
    <button
      type="button"
      className={notificationsButtonClassName}
      onClick={() => onToggleNotifications?.()}
      aria-label={`Notifications (${notifications.length})`}
      data-has-notifications={hasNotifications ? "true" : "false"}
    >!</button>
    <div className={styles.windowControls}>
      <button
        type="button"
        className={styles.windowControlButton}
        aria-label="Minimize window"
        onClick={handleMinimizeWindow}
      >&#8211;</button>
      <button
        type="button"
        className={styles.windowControlButton}
        aria-label="Maximize window"
        onClick={handleToggleMaximizeWindow}
      >&#9723;</button>
      <button
        type="button"
        className={`${styles.windowControlButton} ${styles.windowControlClose}`}
        aria-label="Close window"
        onClick={handleCloseWindow}
      >&times;</button>
    </div>
    {isNotificationsOpen ? <div
      className={styles.notificationsFlyout}
    >
      {notifications.length === 0 ? <p className={styles.notificationsEmpty}>No notifications.</p> : null}
      {notifications.map(notification => <article
        key={notification.id}
        className={`${styles.notificationCard} ${getNotificationToneClassName(notification.tone)}`}
      >
        <h3 className={styles.notificationTitle}>{notification.title || "Notification"}</h3>
        {notification.message ? <p className={styles.notificationMessage}>{notification.message}</p> : null}
        {renderNotificationActions(notification)}
      </article>)}
    </div> : null}
    <DragOverlay dropAnimation={null}>
      {activeTabTitle ? <div className={styles.tabOverlay}>{activeTabTitle}</div> : null}
    </DragOverlay>
  </header>;
}

export default WorkspaceTabStrip;
