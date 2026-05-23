import { useEffect, useMemo, useRef, useState } from "react";
import { resolveFilesystemIconClass } from "./fileIconResolver";
import styles from "./FilesystemPanelGridContent.module.scss";

function GridEntryCell({
  paneId,
  entry,
  isSelected,
  isConfig,
  isRenaming,
  thumbnailSrc,
  onEntryClick,
  onEntryDoubleClick,
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
      type="button"
      className={cellClassName}
      aria-selected={isSelected}
      data-contextmenu-boundary="filesystem-entry"
      data-context-kind={entry.is_dir ? "folder" : "file"}
      data-context-id={entry.path}
      data-context-label={entry.name}
      data-context-path={entry.path}
      data-context-scope="tree-entry"
      data-context-pane-id={paneId}
      onClick={(event) => onEntryClick?.(entry.path, event)}
      onDoubleClick={(event) => onEntryDoubleClick?.(entry, event)}
      onContextMenu={(event) => onEntryContextMenu?.(entry.path, event)}
    >
      {preview}
      <span className={styles.cellName}>{entry.name}</span>
    </button>
  );
}

export default function FilesystemPanelGridContent({
  paneId = "",
  entries = [],
  selectedPathSet = new Set(),
  thumbnailSrcByPath = {},
  workspaceFolderPathSet = new Set(),
  columnCount = 1,
  anchorRef = undefined,
  topSpacerHeight = 0,
  bottomSpacerHeight = 0,
  isWindowingEnabled = false,
  renamingPath = "",
  onEntryClick = undefined,
  onEntryDoubleClick = undefined,
  onEntryContextMenu = undefined,
  onEntryRenameSubmit = undefined,
  onEntryRenameCancel = undefined,
}) {
  return (
    <div
      className={styles.gridContainer}
      style={{ "--grid-cols": columnCount }}
    >
      <div ref={anchorRef} className={styles.gridAnchor} aria-hidden />
      {isWindowingEnabled && topSpacerHeight > 0 && (
        <div
          className={styles.gridSpacer}
          style={{ height: `${topSpacerHeight}px` }}
          aria-hidden
        />
      )}
      {entries.map((entry) => {
        const isConfigFolder = entry.is_dir && entry.name.toLowerCase() === ".grayspace";
        const isConfig = isConfigFolder || workspaceFolderPathSet.has(entry.path);
        return (
          <GridEntryCell
            key={entry.path}
            paneId={paneId}
            entry={entry}
            isSelected={selectedPathSet.has(entry.path)}
            isConfig={isConfig}
            isRenaming={entry.path === renamingPath}
            thumbnailSrc={thumbnailSrcByPath[entry.path] ?? ""}
            onEntryClick={onEntryClick}
            onEntryDoubleClick={onEntryDoubleClick}
            onEntryContextMenu={onEntryContextMenu}
            onEntryRenameSubmit={onEntryRenameSubmit}
            onEntryRenameCancel={onEntryRenameCancel}
          />
        );
      })}
      {isWindowingEnabled && bottomSpacerHeight > 0 && (
        <div
          className={styles.gridSpacer}
          style={{ height: `${bottomSpacerHeight}px` }}
          aria-hidden
        />
      )}
    </div>
  );
}
