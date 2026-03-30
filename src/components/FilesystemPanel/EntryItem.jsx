import { useMemo } from "react";
import { resolveFilesystemIconClass } from "./fileIconResolver";
import styles from "./EntryItem.module.scss";

function EntryItem({
  label,
  meta,
  isSelected = false,
  isFile = false,
  isDirectory = false,
  isConfig = false,
  isDraggable = false,
  isDragging = false,
  isDropTarget = false,
  thumbnailSrc = "",
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
  const entryIconClassName = useMemo(() => resolveFilesystemIconClass(label, {
    isDirectory,
  }), [isDirectory, label]);
  const buttonClassName = [
    styles.entryButton,
    isSelected ? styles.selected : "",
    isFile ? styles.file : "",
    isConfig ? styles.configEntry : "",
    isDraggable ? styles.draggable : "",
    isDragging ? styles.dragging : "",
    isDropTarget ? styles.dropTarget : "",
  ]
    .filter(Boolean)
    .join(" ");

  return <li className={styles.entryItem}>
    <button
      ref={buttonRef}
      type="button"
      className={buttonClassName}
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
      <span className={styles.entryMain}>
        {thumbnailSrc
          ? <img
            src={thumbnailSrc}
            alt=""
            aria-hidden
            draggable={false}
            className={styles.entryThumbnail}
          />
          : <span
            className={`${styles.entryIcon} icon ${entryIconClassName}`}
            aria-hidden
          />}
        <span className={styles.entryName}>{label}</span>
      </span>
      <span className={styles.entryPath}>{meta}</span>
    </button>
  </li>;
}

export default EntryItem;
