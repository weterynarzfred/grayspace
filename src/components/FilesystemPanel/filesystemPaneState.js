import { getSelectedPathsFromState } from "../../utils/pathSelection";

export const FILESYSTEM_THUMBNAIL_SIZE_STEPS = [22, 32, 64, 128, 256];
export const DEFAULT_FILESYSTEM_THUMBNAIL_SIZE = FILESYSTEM_THUMBNAIL_SIZE_STEPS[0];

export const FILESYSTEM_VIEW_TYPES = ["folder-tree", "grid", "foldable-grid"];
export const DEFAULT_FILESYSTEM_VIEW_TYPE = "folder-tree";

function getExpandedPathsFromState(state = {}) {
  if (!state || typeof state !== "object") return [];
  if (!Array.isArray(state.expandedPaths)) return [];

  const seenPaths = new Set();
  const expandedPaths = [];
  state.expandedPaths.forEach((path) => {
    if (typeof path !== "string" || !path || seenPaths.has(path)) return;
    seenPaths.add(path);
    expandedPaths.push(path);
  });
  return expandedPaths;
}

export function normalizeFilesystemThumbnailSize(sizePx) {
  if (!Number.isFinite(sizePx)) return DEFAULT_FILESYSTEM_THUMBNAIL_SIZE;
  const roundedSize = Math.round(sizePx);
  if (FILESYSTEM_THUMBNAIL_SIZE_STEPS.includes(roundedSize)) return roundedSize;
  return DEFAULT_FILESYSTEM_THUMBNAIL_SIZE;
}

export function arePathArraysEqual(leftPaths = [], rightPaths = []) {
  if (leftPaths.length !== rightPaths.length) {
    return false;
  }

  return leftPaths.every((path, index) => path === rightPaths[index]);
}

export function normalizeFilesystemPaneState(filesystemState = {}) {
  const state = filesystemState ?? {};
  const selectedPaths = getSelectedPathsFromState(state);
  const expandedPaths = getExpandedPathsFromState(state);

  return {
    currentDrive: typeof state.currentDrive === "string" ? state.currentDrive : "",
    currentPath: typeof state.currentPath === "string" ? state.currentPath : "",
    selectedPaths,
    expandedPaths,
    scrollTop: Number.isFinite(state.scrollTop) ? Math.max(0, Math.round(state.scrollTop)) : 0,
    thumbnailSizePx: normalizeFilesystemThumbnailSize(state.thumbnailSizePx),
    viewType: FILESYSTEM_VIEW_TYPES.includes(state.viewType) ? state.viewType : DEFAULT_FILESYSTEM_VIEW_TYPE,
  };
}
