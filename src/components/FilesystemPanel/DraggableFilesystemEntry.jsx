import { useDraggable, useDroppable } from "@dnd-kit/core";
import { memo } from "react";
import EntryItem from "./EntryItem";
import { getDragEntryDndId, getEntryDndId } from "./dndIds";

function getDragPaths(isSelectedForDrag, selectedEntryPaths, entryPath) {
  return isSelectedForDrag ? selectedEntryPaths : [entryPath];
}

function getDestinationPath(isDirectory, entryPath, dropDestinationPath) {
  return isDirectory ? entryPath : dropDestinationPath;
}

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

function getIsDropTarget({
  isDirectory,
  destinationPath,
  activeDropDestinationPath,
  activeDragPathSet,
}) {
  if (!isDirectory) return false;
  if (destinationPath !== activeDropDestinationPath) return false;
  if (!activeDragPathSet || activeDragPathSet.size === 0) return false;
  return !activeDragPathSet.has(destinationPath);
}

function DraggableFilesystemEntry({
  paneId = "",
  entry,
  drag = {},
  view = {},
  actions = {},
}) {
  const {
    dropDestinationPath = "",
    selectedEntryPaths = [],
    isSelectedForDrag = false,
    isMovingEntry = false,
    activeDragPathSet = undefined,
    activeDropDestinationPath = "",
  } = drag;
  const {
    isSelected = false,
    isWorkspaceFolder = false,
    thumbnailSrc = "",
    nestingDepth = 0,
    isExpanded = false,
    isRenaming = false,
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
  const dragPaths = getDragPaths(isSelectedForDrag, selectedEntryPaths, entry.path);
  const draggableId = getDragEntryDndId(paneId, entry.path);
  const droppableId = getEntryDndId(entry.path);
  const destinationPath = getDestinationPath(isDirectory, entry.path, dropDestinationPath);
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    isDragging,
  } = useDraggable({
    id: draggableId,
    disabled: isMovingEntry || isRenaming,
    data: {
      sourcePath: entry.path,
      sourcePaneId: paneId,
      dragPaths,
    },
  });
  const { setNodeRef: setDroppableNodeRef } = useDroppable({
    id: droppableId,
    disabled: isMovingEntry || isRenaming || !destinationPath,
    data: {
      kind: "entry",
      path: destinationPath,
      isDirectory: true,
    },
  });

  function setNodeRef(node) {
    setDraggableNodeRef(node);
    setDroppableNodeRef(node);
  }

  const isDropTarget = getIsDropTarget({
    isDirectory,
    destinationPath,
    activeDropDestinationPath,
    activeDragPathSet,
  });
  const isActiveDragSource = activeDragPathSet?.has(entry.path) ?? false;
  const shouldShowDraggingState = isDragging && isActiveDragSource;
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
    isDraggable={!isMovingEntry}
    isDragging={shouldShowDraggingState}
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
