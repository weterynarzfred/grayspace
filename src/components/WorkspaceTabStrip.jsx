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
}) {
  const activeTabTitle = tabs.find(tab => tab.tabId === activeDragTabId)?.title ?? "";

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
    <DragOverlay dropAnimation={null}>
      {activeTabTitle ? <div className={styles.tabOverlay}>{activeTabTitle}</div> : null}
    </DragOverlay>
  </header>;
}

export default WorkspaceTabStrip;
