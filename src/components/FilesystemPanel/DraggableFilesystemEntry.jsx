import { useDraggable, useDroppable } from "@dnd-kit/core";
import EntryItem from "./EntryItem";
import { getEntryDndId } from "./dndIds";

function DraggableFilesystemEntry({
  entry,
  isSelected,
  isMovingEntry,
  activeDragPaths = [],
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
