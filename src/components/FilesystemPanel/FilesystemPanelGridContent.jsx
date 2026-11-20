import GridEntryCell from "./GridEntryCell";
import styles from "./FilesystemPanelGridContent.module.scss";

export default function FilesystemPanelGridContent({
  paneId = "",
  entries = [],
  selectedPathSet = new Set(),
  thumbnailSrcByPath = {},
  workspaceFolderPathSet = new Set(),
  columnCount = 1,
  minCellWidthPx = 72,
  previewSizePx = 22,
  rowHeightPx = 62,
  containerRef = undefined,
  anchorRef = undefined,
  topSpacerHeight = 0,
  bottomSpacerHeight = 0,
  isWindowingEnabled = false,
  renamingPath = "",
  drag = {},
  onEntryClick = undefined,
  onEntryDoubleClick = undefined,
  onEntryMiddleClick = undefined,
  onEntryContextMenu = undefined,
  onEntryRenameSubmit = undefined,
  onEntryRenameCancel = undefined,
}) {
  return (
    <div
      ref={containerRef}
      className={styles.gridContainer}
      style={{
        "--grid-cols": columnCount,
        "--grid-min-cell-width": `${minCellWidthPx}px`,
        "--grid-preview-size": `${previewSizePx}px`,
        "--grid-row-height": `${rowHeightPx}px`,
      }}
    >
      <div ref={anchorRef} aria-hidden />
      {isWindowingEnabled && topSpacerHeight > 0 && (
        <div style={{ height: `${topSpacerHeight}px` }} aria-hidden />
      )}
      <div className={styles.gridCells}>
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
              drag={drag}
              onEntryClick={onEntryClick}
              onEntryDoubleClick={onEntryDoubleClick}
              onEntryMiddleClick={onEntryMiddleClick}
              onEntryContextMenu={onEntryContextMenu}
              onEntryRenameSubmit={onEntryRenameSubmit}
              onEntryRenameCancel={onEntryRenameCancel}
            />
          );
        })}
      </div>
      {isWindowingEnabled && bottomSpacerHeight > 0 && (
        <div style={{ height: `${bottomSpacerHeight}px` }} aria-hidden />
      )}
    </div>
  );
}
