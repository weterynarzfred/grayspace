import { DragOverlay } from "@dnd-kit/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import appIcon from "../../src-tauri/icons/icon.svg";
import WorkspaceTabItem from "./WorkspaceTabItem";
import styles from "./WorkspaceTabStrip.module.scss";

function WorkspaceTabStrip({
  tabs,
  activeTabId,
  activeDragTabId,
  onActivateTab,
  onCloseTab,
  onMiddleClickTab = undefined,
  onCreateTab,
}) {
  const handleMinimizeWindow = () => {
    getCurrentWindow().minimize();
  };
  const handleToggleMaximizeWindow = () => {
    getCurrentWindow().toggleMaximize();
  };
  const handleCloseWindow = () => {
    getCurrentWindow().close();
  };
  const activeTabTitle = tabs.find(tab => tab.tabId === activeDragTabId)?.title ?? "";

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
        onMiddleClick={onMiddleClickTab || onCloseTab}
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
    <DragOverlay dropAnimation={null}>
      {activeTabTitle ? <div className={styles.tabOverlay}>{activeTabTitle}</div> : null}
    </DragOverlay>
  </header>;
}

export default WorkspaceTabStrip;
