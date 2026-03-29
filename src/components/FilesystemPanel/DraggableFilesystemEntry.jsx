import { useDraggable, useDroppable } from "@dnd-kit/core";
import EntryItem from "./EntryItem";
import { getDragEntryDndId, getEntryDndId } from "./dndIds";

function DraggableFilesystemEntry({
  paneId = "",
  entry,
  isSelected,
  isMovingEntry,
  activeDragPaths = [],
  onClick,
  onDoubleClick,
}) {
  const draggableId = getDragEntryDndId(paneId, entry.path);
  const droppableId = getEntryDndId(entry.path);
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
    },
  });
  const { isOver, setNodeRef: setDroppableNodeRef } = useDroppable({
    id: droppableId,
    disabled: isMovingEntry || !entry.is_dir,
    data: {
      kind: "entry",
      path: entry.path,
      isDirectory: entry.is_dir,
    },
  });

  function setNodeRef(node) {
    setDraggableNodeRef(node);
    setDroppableNodeRef(node);
  }

  const isDropTarget =
    entry.is_dir
    && isOver
    && activeDragPaths.length > 0
    && !activeDragPaths.includes(entry.path);
  const isConfigEntry =
    entry.is_dir && (entry.name ?? "").toLowerCase() === ".grayspace";
  const metaLabel = isConfigEntry ? "config" : (entry.is_dir ? "Folder" : "File");

  return (
    <EntryItem
      label={entry.name}
      meta={metaLabel}
      isSelected={isSelected}
      isFile={!entry.is_dir}
      isConfig={isConfigEntry}
      isDraggable={!isMovingEntry}
      isDragging={isDragging}
      isDropTarget={isDropTarget}
      buttonRef={setNodeRef}
      dndAttributes={attributes}
      dndListeners={listeners}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    />
  );
}

export default DraggableFilesystemEntry;
