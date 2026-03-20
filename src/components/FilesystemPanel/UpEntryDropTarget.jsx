import { useDroppable } from "@dnd-kit/core";
import EntryItem from "./EntryItem";
import { getUpDndId } from "./dndIds";

function UpEntryDropTarget({
  destinationPath,
  isSelected,
  isMovingEntry,
  activeDragPaths = [],
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
    activeDragPaths.length > 0 &&
    !activeDragPaths.includes(destinationPath);

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
