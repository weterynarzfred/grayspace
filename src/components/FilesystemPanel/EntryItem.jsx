import { useEffect, useMemo, useRef, useState } from "react";
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
  contextKind = "",
  contextId = "",
  contextLabel = "",
  contextPath = "",
  contextScope = "",
  contextPaneId = "",
  isRenaming = false,
  renameInitialValue = "",
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
  onContextMenu,
  onRenameSubmit,
  onRenameCancel,
}) {
  const hasDndListeners = Boolean(dndListeners && Object.keys(dndListeners).length > 0);
  const entryIconClassName = useMemo(() => resolveFilesystemIconClass(label, {
    isDirectory,
  }), [isDirectory, label]);
  const renameInputRef = useRef(null);
  const renameSettledRef = useRef(false);
  const [renameValue, setRenameValue] = useState(renameInitialValue || label);
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
  const editingClassName = `${buttonClassName} ${styles.entryButtonEditing}`;

  useEffect(() => {
    if (!isRenaming) return;
    renameSettledRef.current = false;
    const nextValue = renameInitialValue || label;
    setRenameValue(nextValue);
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [isRenaming, label, renameInitialValue]);

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

  function handleRenameCommit() {
    if (renameSettledRef.current) return;
    renameSettledRef.current = true;
    onRenameSubmit?.(renameValue);
  }

  function handleRenameCancel() {
    if (renameSettledRef.current) return;
    renameSettledRef.current = true;
    onRenameCancel?.();
  }

  function handleRenameKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleRenameCommit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      handleRenameCancel();
    }
  }

  const indent = nestingDepth > 0 ? <span className={styles.entryIndent} aria-hidden>
    {Array.from({ length: nestingDepth }, (_, index) => <span
      key={`indent-${index}`}
      className={styles.indentGuide}
    />)}
  </span> : null;
  const entryPreview = thumbnailSrc
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
    />;

  if (isRenaming) {
    return <li className={styles.entryItem}>
      <div
        className={editingClassName}
        style={buttonStyle}
      >
        <span className={styles.entryMain}>
          {indent}
          <span className={styles.entryExpanderSpacer} aria-hidden />
          {entryPreview}
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            className={styles.entryRenameInput}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={handleRenameCommit}
            onKeyDown={handleRenameKeyDown}
          />
        </span>
        <span className={styles.entryPath}>{meta}</span>
      </div>
    </li>;
  }

  return <li className={styles.entryItem}>
    <button
      ref={buttonRef}
      type="button"
      className={buttonClassName}
      aria-selected={isSelected}
      draggable={isDraggable && !hasDndListeners}
      style={buttonStyle}
      data-drop-destination-path={dropDestinationPath || undefined}
      data-contextmenu-boundary={contextKind ? "filesystem-entry" : undefined}
      data-context-kind={contextKind || undefined}
      data-context-id={contextId || undefined}
      data-context-label={contextLabel || label}
      data-context-path={contextPath || undefined}
      data-context-scope={contextScope || undefined}
      data-context-pane-id={contextPaneId || undefined}
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
      onContextMenu={onContextMenu}
    >
      <span className={styles.entryMain}>
        {indent}
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
        {entryPreview}
        <span className={styles.entryName}>{label}</span>
      </span>
      <span className={styles.entryPath}>{meta}</span>
    </button>
  </li>;
}

export default EntryItem;
