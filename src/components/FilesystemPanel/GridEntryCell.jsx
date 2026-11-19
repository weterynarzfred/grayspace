import { useEffect, useMemo, useRef, useState } from "react";
import { resolveFilesystemIconClass } from "./fileIconResolver";
import useFilesystemEntryDnd from "./hooks/useFilesystemEntryDnd";
import { getParentDirectoryPath } from "../../utils/pathWatch";
import styles from "./GridEntryCell.module.scss";

export default function GridEntryCell({
  paneId,
  entry,
  isSelected,
  isConfig,
  isRenaming,
  thumbnailSrc,
  drag,
  onEntryClick,
  onEntryDoubleClick,
  onEntryMiddleClick,
  onEntryContextMenu,
  onEntryRenameSubmit,
  onEntryRenameCancel,
}) {
  const iconClass = useMemo(
    () => resolveFilesystemIconClass(entry.name, { isDirectory: entry.is_dir }),
    [entry.name, entry.is_dir],
  );
  const renameInputRef = useRef(null);
  const renameSettledRef = useRef(false);
  const [renameValue, setRenameValue] = useState(entry.name);
  const dnd = useFilesystemEntryDnd({
    paneId,
    entry,
    isRenaming,
    drag: {
      ...drag,
      dropDestinationPath: getParentDirectoryPath(entry.path),
      isSelectedForDrag: isSelected,
    },
  });

  useEffect(() => {
    if (!isRenaming) return;
    renameSettledRef.current = false;
    setRenameValue(entry.name);
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [isRenaming, entry.name]);

  function handleRenameCommit() {
    if (renameSettledRef.current) return;
    renameSettledRef.current = true;
    onEntryRenameSubmit?.(entry.path, renameValue);
  }

  function handleRenameCancel() {
    if (renameSettledRef.current) return;
    renameSettledRef.current = true;
    onEntryRenameCancel?.(entry.path);
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

  const cellClassName = [
    styles.cell,
    isSelected ? styles.cellSelected : "",
    isConfig ? styles.cellConfig : "",
    entry.is_hidden ? styles.cellHidden : "",
    dnd.isDragging ? styles.cellDragging : "",
    dnd.isDropTarget ? styles.cellDropTarget : "",
  ].filter(Boolean).join(" ");

  const preview = (
    <span className={styles.cellPreview}>
      {thumbnailSrc
        ? <img
          src={thumbnailSrc}
          alt=""
          aria-hidden
          draggable={false}
          className={styles.cellThumbnail}
        />
        : <span className={`${styles.cellIcon} icon ${iconClass}`} aria-hidden />
      }
    </span>
  );

  if (isRenaming) {
    return (
      <div className={`${cellClassName} ${styles.cellRenaming}`}>
        {preview}
        <input
          ref={renameInputRef}
          type="text"
          value={renameValue}
          className={styles.cellRenameInput}
          onChange={(event) => setRenameValue(event.target.value)}
          onBlur={handleRenameCommit}
          onKeyDown={handleRenameKeyDown}
        />
      </div>
    );
  }

  return (
    <button
      ref={dnd.setNodeRef}
      type="button"
      className={cellClassName}
      aria-selected={isSelected}
      {...dnd.attributes}
      {...dnd.listeners}
      data-drop-destination-path={dnd.destinationPath || undefined}
      data-contextmenu-boundary="filesystem-entry"
      data-context-kind={entry.is_dir ? "folder" : "file"}
      data-context-id={entry.path}
      data-context-label={entry.name}
      data-context-path={entry.path}
      data-context-scope="tree-entry"
      data-context-pane-id={paneId}
      onClick={(event) => onEntryClick?.(entry.path, event)}
      onDoubleClick={(event) => onEntryDoubleClick?.(entry, event)}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onMouseUp={(event) => onEntryMiddleClick?.(entry, event)}
      onContextMenu={(event) => onEntryContextMenu?.(entry.path, event)}
    >
      {preview}
      <span className={styles.cellName}>{entry.name}</span>
    </button>
  );
}
