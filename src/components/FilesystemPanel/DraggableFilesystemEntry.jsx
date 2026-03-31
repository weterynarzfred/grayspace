import { useDraggable, useDroppable } from "@dnd-kit/core";
import { memo, useMemo } from "react";
import EntryItem from "./EntryItem";
import { getDragEntryDndId, getEntryDndId } from "./dndIds";

function DraggableFilesystemEntry({
  paneId = "",
  entry,
  dropDestinationPath = "",
  selectedEntryPaths = [],
  isSelectedForDrag = false,
  isSelected,
  isMovingEntry,
  activeDragPathSet = undefined,
  activeDropDestinationPath = "",
  isWorkspaceFolder = false,
  thumbnailSrc = "",
  nestingDepth = 0,
  isExpanded = false,
  onToggleExpand = undefined,
  onEntryClick,
  onEntryDoubleClick,
  onEntryMiddleClick = undefined,
}) {
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
    isDragging={isDragging}
    isDropTarget={isDropTarget}
    thumbnailSrc={!entry.is_dir ? thumbnailSrc : ""}
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
