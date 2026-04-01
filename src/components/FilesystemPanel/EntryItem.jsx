import { useMemo } from "react";
import { resolveFilesystemIconClass } from "./fileIconResolver";
import styles from "./EntryItem.module.scss";

function EntryItem({
  label,
  meta,
  isSelected = false,
  isFile = false,
  isDirectory = false,
  nestingDepth = 0,
  showExpander = false,
  isExpanded = false,
  isConfig = false,
  isDraggable = false,
  isDragging = false,
  isDropTarget = false,
  thumbnailSrc = "",
  dropDestinationPath = "",
  buttonRef,
  buttonStyle,
  dndAttributes,
  dndListeners,
  onToggleExpand,
  onClick,
  onDoubleClick,
  onAuxClick,
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
  const resolvedButtonStyle = {
    ...(buttonStyle ?? {}),
    "--entry-depth": nestingDepth,
  };
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

  function handleExpanderClick(event) {
    event.preventDefault();
    event.stopPropagation();
    onToggleExpand?.();
  }

  function handleExpanderDoubleClick(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleButtonMouseDown(event) {
    if (event.button !== 1) return;
    event.preventDefault();
  }

  function handleButtonMouseUp(event) {
    if (event.button !== 1) return;
    onAuxClick?.(event);
  }

  return <li className={styles.entryItem}>
    <button
      ref={buttonRef}
      type="button"
      className={buttonClassName}
      aria-selected={isSelected}
      draggable={isDraggable && !hasDndListeners}
      style={resolvedButtonStyle}
      data-drop-destination-path={dropDestinationPath || undefined}
      {...dndAttributes}
      {...dndListeners}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={handleButtonMouseDown}
      onMouseUp={handleButtonMouseUp}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className={styles.entryMain}>
        {showExpander
          ? <span
            className={`${styles.entryExpander} ${isExpanded ? styles.expanded : ""}`}
            data-entry-expander
            aria-hidden
            onClick={handleExpanderClick}
            onDoubleClick={handleExpanderDoubleClick}
          >
            <svg viewBox="0 0 10 10">
              <path d="M3 1L7 5L3 9" />
            </svg>
          </span>
          : <span className={styles.entryExpanderSpacer} aria-hidden />}
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
