import { parseEntryPath } from "./FilesystemPanel/dndIds";
import { uniqueNonEmptyPaths } from "../utils/pathSelection";

export function getDraggedPathsFromDndEvent(event) {
  const dragPaths = event?.active?.data?.current?.dragPaths;
  const normalizedDragPaths = uniqueNonEmptyPaths(dragPaths);
  if (normalizedDragPaths.length > 0) {
    return normalizedDragPaths;
  }

  const sourcePathFromData = event?.active?.data?.current?.sourcePath;
  const sourcePath = typeof sourcePathFromData === "string" && sourcePathFromData
    ? sourcePathFromData
    : parseEntryPath(event?.active?.id);
  return uniqueNonEmptyPaths([sourcePath]);
}

export function getFirstDraggedPathFromDndEvent(event) {
  const draggedPaths = getDraggedPathsFromDndEvent(event);
  return draggedPaths[0] ?? "";
}
