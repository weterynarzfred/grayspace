import { useDraggable, useDroppable } from "@dnd-kit/core";
import { memo, useMemo } from "react";
import EntryItem from "./EntryItem";
import { getDragEntryDndId, getEntryDndId } from "./dndIds";

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
  } = view;
  const {
    onToggleExpand = undefined,
    onEntryClick = undefined,
    onEntryDoubleClick = undefined,
    onEntryMiddleClick = undefined,
  } = actions;

  const selfDragPath = useMemo(() => [entry.path], [entry.path]);
  const dragPaths = isSelectedForDrag ? selectedEntryPaths : selfDragPath;
  const draggableId = getDragEntryDndId(paneId, entry.path);
  const droppableId = getEntryDndId(entry.path);
  const destinationPath = entry.is_dir ? entry.path : dropDestinationPath;
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    isDragging,
  } = useDraggable({
    id: draggableId,
    disabled: isMovingEntry,
    data: {
      sourcePath: entry.path,
      sourcePaneId: paneId,
      dragPaths,
    },
  });
  const { setNodeRef: setDroppableNodeRef } = useDroppable({
    id: droppableId,
    disabled: isMovingEntry || !destinationPath,
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

  const isDropTarget =
    entry.is_dir
    && destinationPath === activeDropDestinationPath
    && activeDragPathSet?.size > 0
    && !activeDragPathSet.has(destinationPath);
  const isActiveDragSource = activeDragPathSet?.has(entry.path) ?? false;
  const shouldShowDraggingState = isDragging && isActiveDragSource;
  const isConfigFolder =
    entry.is_dir && (entry.name ?? "").toLowerCase() === ".grayspace";
  const shouldUseConfigStyle = isConfigFolder || isWorkspaceFolder;
  const metaLabel = isConfigFolder ? "config" : (entry.is_dir ? "Folder" : "File");

  return <EntryItem
    label={entry.name}
    meta={metaLabel}
    isSelected={isSelected}
    isFile={!entry.is_dir}
    isDirectory={entry.is_dir}
    isConfig={shouldUseConfigStyle}
    isDraggable={!isMovingEntry}
    isDragging={shouldShowDraggingState}
    isDropTarget={isDropTarget}
    thumbnailSrc={!entry.is_dir ? thumbnailSrc : ""}
    dropDestinationPath={destinationPath}
    contextKind={entry.is_dir ? "folder" : "file"}
    contextId={entry.path}
    contextLabel={entry.name}
    contextPath={entry.path}
    nestingDepth={nestingDepth}
    showExpander={entry.is_dir}
    isExpanded={isExpanded}
    onToggleExpand={onToggleExpand}
    buttonRef={setNodeRef}
    dndAttributes={attributes}
    dndListeners={listeners}
    onClick={(event) => onEntryClick?.(entry.path, event)}
    onDoubleClick={() => onEntryDoubleClick?.(entry)}
    onAuxClick={(event) => onEntryMiddleClick?.(entry, event)}
  />;
}

export default memo(DraggableFilesystemEntry);
