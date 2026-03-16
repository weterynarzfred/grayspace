import styles from "./EntryItem.module.scss";

function EntryItem({
  label,
  meta,
  isSelected = false,
  isFile = false,
  isDraggable = false,
  isDragging = false,
  isDropTarget = false,
  buttonRef,
  buttonStyle,
  dndAttributes,
  dndListeners,
  onClick,
  onDoubleClick,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
}) {
  const hasDndListeners = Boolean(dndListeners && Object.keys(dndListeners).length > 0);

  return (
    <li className={styles.entryItem}>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.entryButton} ${isSelected ? styles.selected : ""} ${
          isFile ? styles.file : ""
        } ${isDraggable ? styles.draggable : ""} ${isDragging ? styles.dragging : ""} ${
          isDropTarget ? styles.dropTarget : ""
        }`}
        aria-selected={isSelected}
        draggable={isDraggable && !hasDndListeners}
        style={buttonStyle}
        {...dndAttributes}
        {...dndListeners}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <span className={styles.entryName}>{label}</span>
        <span className={styles.entryPath}>{meta}</span>
      </button>
    </li>
  );
}

export default EntryItem;
