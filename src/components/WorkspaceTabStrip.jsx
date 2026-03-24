import { useEffect, useRef, useState } from "react";
import { DragOverlay } from "@dnd-kit/core";
import WorkspaceTabItem from "./WorkspaceTabItem";
import styles from "./WorkspaceTabStrip.module.scss";

function WorkspaceTabStrip({
  tabs,
  activeTabId,
  activeDragTabId,
  onActivateTab,
  onCloseTab,
  onCreateTab,
  onCreateWindow,
  notifications = [],
  isNotificationsOpen = false,
  onToggleNotifications = undefined,
  onDismissNotification = undefined,
  onResolveNotificationConfirm = undefined,
}) {
  const activeTabTitle = tabs.find(tab => tab.tabId === activeDragTabId)?.title ?? "";
  const notificationsButtonRef = useRef(null);
  const hasNotifications = notifications.length > 0;

  return <header className={styles.tabStrip}>
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
    <button
      ref={notificationsButtonRef}
      type="button"
      className={`${styles.notificationsButton} ${hasNotifications ? styles.notificationsButtonAlert : ""}`}
      onClick={() => onToggleNotifications?.()}
      aria-label={`Notifications (${notifications.length})`}
      data-has-notifications={hasNotifications ? "true" : "false"}
    >!</button>
    {isNotificationsOpen ? <div
      className={styles.notificationsFlyout}
    >
      {notifications.length === 0 ? <p className={styles.notificationsEmpty}>No notifications.</p> : null}
      {notifications.map(notification => <article
        key={notification.id}
        className={`${styles.notificationCard} ${styles[`notificationTone${notification.tone === "error" ? "Error" : notification.tone === "warning" ? "Warning" : notification.tone === "success" ? "Success" : "Info"}`]}`}
      >
        <h3 className={styles.notificationTitle}>{notification.title || "Notification"}</h3>
        {notification.message ? <p className={styles.notificationMessage}>{notification.message}</p> : null}
        {notification.kind === "confirm" ? <div className={styles.notificationActions}>
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
        </div> : <div className={styles.notificationActions}>
          <button
            type="button"
            className={styles.notificationActionButton}
            onClick={() => onDismissNotification?.(notification.id)}
          >
            Dismiss
          </button>
        </div>}
      </article>)}
    </div> : null}
    <DragOverlay dropAnimation={null}>
      {activeTabTitle ? <div className={styles.tabOverlay}>{activeTabTitle}</div> : null}
    </DragOverlay>
  </header>;
}

export default WorkspaceTabStrip;
