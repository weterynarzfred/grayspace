import { useDraggable, useDroppable } from "@dnd-kit/core";
import EntryItem from "./EntryItem";
import { getEntryDndId } from "./dndIds";

function DraggableFilesystemEntry({
  entry,
  isSelected,
  isMovingEntry,
  activeDragPath,
  onClick,
  onDoubleClick,
}) {
  const dndId = getEntryDndId(entry.path);
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    isDragging,
  } = useDraggable({
    id: dndId,
    disabled: isMovingEntry,
  });
  const { isOver, setNodeRef: setDroppableNodeRef } = useDroppable({
    id: dndId,
    disabled: isMovingEntry || !entry.is_dir,
  });

  function setNodeRef(node) {
    setDraggableNodeRef(node);
    setDroppableNodeRef(node);
  }

  const isDropTarget =
    entry.is_dir && isOver && Boolean(activeDragPath) && activeDragPath !== entry.path;

  return (
    <EntryItem
      label={entry.name}
      meta={entry.is_dir ? "Folder" : "File"}
      isSelected={isSelected}
      isFile={!entry.is_dir}
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
