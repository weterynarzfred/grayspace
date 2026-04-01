export const EXTERNAL_FILESYSTEM_DRAG_START_EVENT = "grayspace:filesystem-external-drag-start";

export function emitExternalFilesystemDragStart() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EXTERNAL_FILESYSTEM_DRAG_START_EVENT));
}
