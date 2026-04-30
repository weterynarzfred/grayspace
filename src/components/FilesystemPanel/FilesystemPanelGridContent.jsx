import { useMemo } from "react";
import { resolveFilesystemIconClass } from "./fileIconResolver";
import styles from "./FilesystemPanelGridContent.module.scss";

function GridEntryCell({
  paneId,
  entry,
  isSelected,
  isConfig,
  thumbnailSrc,
  onEntryClick,
  onEntryDoubleClick,
  onEntryContextMenu,
}) {
  const iconClass = useMemo(
    () => resolveFilesystemIconClass(entry.name, { isDirectory: entry.is_dir }),
    [entry.name, entry.is_dir],
  );

  return (
    <button
      type="button"
      className={[styles.cell, isSelected ? styles.cellSelected : "", isConfig ? styles.cellConfig : ""].filter(Boolean).join(" ")}
      aria-selected={isSelected}
      data-contextmenu-boundary="filesystem-entry"
      data-context-kind={entry.is_dir ? "folder" : "file"}
      data-context-id={entry.path}
      data-context-label={entry.name}
      data-context-path={entry.path}
      data-context-scope="grid-entry"
      data-context-pane-id={paneId}
      onClick={(event) => onEntryClick?.(entry.path, event)}
      onDoubleClick={(event) => onEntryDoubleClick?.(entry, event)}
      onContextMenu={(event) => onEntryContextMenu?.(entry.path, event)}
    >
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
  onEntryClick = undefined,
  onEntryDoubleClick = undefined,
  onEntryContextMenu = undefined,
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
            thumbnailSrc={thumbnailSrcByPath[entry.path] ?? ""}
            onEntryClick={onEntryClick}
            onEntryDoubleClick={onEntryDoubleClick}
            onEntryContextMenu={onEntryContextMenu}
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
