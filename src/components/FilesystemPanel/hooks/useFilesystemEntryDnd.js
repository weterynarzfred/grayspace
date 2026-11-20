import { useDraggable, useDroppable } from "@dnd-kit/core";
import { getDragEntryDndId, getEntryDndId } from "../dndIds";

// Makes an entry draggable (dragging a selected entry drags the whole selection) and a drop
// target: a folder takes drops itself, a file passes them to `dropDestinationPath`.
export default function useFilesystemEntryDnd({ paneId, entry, drag, isRenaming }) {
  const {
    dropDestinationPath = "",
    selectedEntryPaths = [],
    isSelectedForDrag = false,
    activeDragPathSet = undefined,
    activeDropDestinationPath = "",
  } = drag;
  const destinationPath = entry.is_dir ? entry.path : dropDestinationPath;
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    isDragging,
  } = useDraggable({
    id: getDragEntryDndId(paneId, entry.path),
    disabled: isRenaming,
    data: {
      kind: "filesystem-entry",
      sourcePath: entry.path,
      sourcePaneId: paneId,
      dragPaths: isSelectedForDrag ? selectedEntryPaths : [entry.path],
    },
  });
  const { setNodeRef: setDroppableNodeRef } = useDroppable({
    id: getEntryDndId(entry.path),
    disabled: isRenaming || !destinationPath,
    data: {
      kind: "entry",
      path: destinationPath,
      isDirectory: true,
      paneId,
    },
  });

  const hasActiveDrag = Boolean(activeDragPathSet && activeDragPathSet.size > 0);
  return {
    setNodeRef: (node) => {
      setDraggableNodeRef(node);
      setDroppableNodeRef(node);
    },
    attributes,
    listeners,
    destinationPath,
    isDragging: isDragging && (activeDragPathSet?.has(entry.path) ?? false),
    isDropTarget: entry.is_dir
      && hasActiveDrag
      && destinationPath === activeDropDestinationPath
      && !activeDragPathSet.has(destinationPath),
  };
}
