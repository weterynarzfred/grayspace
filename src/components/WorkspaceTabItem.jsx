import { useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { getTabDndId } from "../workspace/dragCoordinator";
import styles from "./WorkspaceTabStrip.module.scss";

export default function WorkspaceTabItem({ tab, isActive, onActivate, onClose }) {
  const dndId = getTabDndId(tab.tabId);
  const { setNodeRef: setDraggableRef, attributes, listeners, isDragging } = useDraggable({
    id: dndId,
  });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: dndId });

  const setNodeRef = useCallback(node => {
    setDraggableRef(node);
    setDroppableRef(node);
  }, [setDraggableRef, setDroppableRef]);
  const handleActivate = () => onActivate(tab.tabId);
  const handleMiddleClick = (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    onClose(tab.tabId);
  };
  const handleClose = (event) => {
    event.stopPropagation();
    onClose(tab.tabId);
  };
  const className = [
    styles.tabItem,
    isActive ? styles.tabItemActive : "",
    isDragging ? styles.tabItemDragging : "",
    isOver ? styles.tabItemDropTarget : "",
  ].filter(Boolean).join(" ");

  return <div ref={setNodeRef} className={className}>
    <button
      type="button"
      className={styles.tabButton}
      onClick={handleActivate}
      onAuxClick={handleMiddleClick}
      {...attributes}
      {...listeners}
    >{tab.title}</button>
    <button
      type="button"
      className={styles.tabCloseButton}
      onClick={handleClose}
      aria-label={`Close ${tab.title}`}
    >&times;</button>
  </div>;
}
