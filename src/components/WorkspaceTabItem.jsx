import { useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { getTabDndId } from "../workspace/dragCoordinator";
import styles from "./WorkspaceTabStrip.module.scss";

function WorkspaceTabItem({ tab, isActive, onActivate, onClose }) {
  const dndId = getTabDndId(tab.tabId);
  const { setNodeRef: setDraggableRef, attributes, listeners, isDragging } = useDraggable({
    id: dndId,
  });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: dndId });

  const setNodeRef = useCallback(node => {
    setDraggableRef(node);
    setDroppableRef(node);
  }, [setDraggableRef, setDroppableRef]);

  return <div
    ref={setNodeRef}
    className={`${styles.tabItem} ${isActive ? styles.tabItemActive : ""} ${isDragging ? styles.tabItemDragging : ""} ${isOver ? styles.tabItemDropTarget : ""}`}
  >
    <button
      type="button"
      className={styles.tabButton}
      onClick={() => onActivate(tab.tabId)}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.stopPropagation();
        onClose(tab.tabId);
      }}
      {...attributes}
      {...listeners}
    >{tab.title}</button>
    <button
      type="button"
      className={styles.tabCloseButton}
      onClick={event => {
        event.stopPropagation();
        onClose(tab.tabId);
      }}
      aria-label={`Close ${tab.title}`}
    >&times;</button>
  </div>;
}

export default WorkspaceTabItem;
