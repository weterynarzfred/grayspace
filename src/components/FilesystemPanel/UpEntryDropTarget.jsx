import { useDroppable } from "@dnd-kit/core";
import EntryItem from "./EntryItem";
import { getUpDndId } from "./dndIds";

function UpEntryDropTarget({
  destinationPath,
  isSelected,
  isMovingEntry,
  activeDragPath,
  onClick,
  onDoubleClick,
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: getUpDndId(destinationPath),
    disabled: isMovingEntry || !destinationPath,
  });
  const isDropTarget =
    Boolean(destinationPath) &&
    isOver &&
    Boolean(activeDragPath) &&
    activeDragPath !== destinationPath;

  return (
    <EntryItem
      label=".."
      meta="Up"
      isSelected={isSelected}
      isDropTarget={isDropTarget}
      buttonRef={setNodeRef}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    />
  );
}

export default UpEntryDropTarget;
