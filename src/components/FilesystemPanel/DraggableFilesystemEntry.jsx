import { memo } from "react";
import EntryItem from "./EntryItem";
import { getEntryDetails } from "./filesystemEntryDetails";
import useFilesystemEntryDnd from "./hooks/useFilesystemEntryDnd";

function getMetaPresentation(entryName, isDirectory, isWorkspaceFolder) {
  const isConfigFolder = isDirectory && (entryName ?? "").toLowerCase() === ".grayspace";
  const shouldUseConfigStyle = isConfigFolder || isWorkspaceFolder;

  let metaLabel = "File";
  if (isConfigFolder) metaLabel = "config";
  else if (isDirectory) metaLabel = "Folder";

  return {
    metaLabel,
    shouldUseConfigStyle,
    contextKind: isDirectory ? "folder" : "file",
    thumbnailValue: isDirectory ? "" : undefined,
  };
}

function DraggableFilesystemEntry({
  paneId = "",
  entry,
  drag = {},
  view = {},
  actions = {},
}) {
  const {
    isSelected = false,
    isWorkspaceFolder = false,
    thumbnailSrc = "",
    nestingDepth = 0,
    isExpanded = false,
    isRenaming = false,
    showDetails = false,
    location = "",
  } = view;
  const {
    onToggleExpand = undefined,
    onEntryClick = undefined,
    onEntryDoubleClick = undefined,
    onEntryMiddleClick = undefined,
    onEntryContextMenu = undefined,
    onEntryRenameSubmit = undefined,
    onEntryRenameCancel = undefined,
  } = actions;

  const isDirectory = entry.is_dir;
  const {
    setNodeRef,
    attributes,
    listeners,
    destinationPath,
    isDragging,
    isDropTarget,
  } = useFilesystemEntryDnd({ paneId, entry, drag, isRenaming });
  const {
    metaLabel,
    shouldUseConfigStyle,
    contextKind,
    thumbnailValue,
  } = getMetaPresentation(entry.name, isDirectory, isWorkspaceFolder);

  return <EntryItem
    label={entry.name}
    meta={metaLabel}
    isSelected={isSelected}
    isFile={!isDirectory}
    isDirectory={isDirectory}
    isConfig={shouldUseConfigStyle}
    isHidden={entry.is_hidden}
    details={showDetails ? getEntryDetails(entry) : null}
    location={location}
    isDraggable={!drag.isMovingEntry}
    isDragging={isDragging}
    isDropTarget={isDropTarget}
    thumbnailSrc={thumbnailValue ?? thumbnailSrc}
    dropDestinationPath={destinationPath}
    contextKind={contextKind}
    contextId={entry.path}
    contextLabel={entry.name}
    contextPath={entry.path}
    contextScope="tree-entry"
    contextPaneId={paneId}
    nestingDepth={nestingDepth}
    showExpander={isDirectory}
    isExpanded={isExpanded}
    isRenaming={isRenaming}
    renameInitialValue={entry.name}
    onToggleExpand={onToggleExpand}
    buttonRef={setNodeRef}
    dndAttributes={attributes}
    dndListeners={listeners}
    onClick={(event) => onEntryClick?.(entry.path, event)}
    onDoubleClick={(event) => onEntryDoubleClick?.(entry, event)}
    onAuxClick={(event) => onEntryMiddleClick?.(entry, event)}
    onContextMenu={(event) => onEntryContextMenu?.(entry.path, event)}
    onRenameSubmit={(nextName) => onEntryRenameSubmit?.(entry.path, nextName)}
    onRenameCancel={() => onEntryRenameCancel?.(entry.path)}
  />;
}

export default memo(DraggableFilesystemEntry);
