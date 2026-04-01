import { parseEntryPath } from "./FilesystemPanel/dndIds";
import { uniqueNonEmptyPaths } from "../utils/pathSelection";

export function getDraggedPathsFromDndEvent(event) {
  const dragPaths = uniqueNonEmptyPaths(event?.active?.data?.current?.dragPaths);
  if (dragPaths.length > 0) return dragPaths;

  const sourcePath = event?.active?.data?.current?.sourcePath || parseEntryPath(event?.active?.id);
  return uniqueNonEmptyPaths([sourcePath]);
}

export function getFirstDraggedPathFromDndEvent(event) {
  const draggedPaths = getDraggedPathsFromDndEvent(event);
  return draggedPaths[0] ?? "";
}
