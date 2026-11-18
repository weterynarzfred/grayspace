import { getSelectedPathsFromState } from "../../utils/pathSelection";
import { normalizeSearchOptions } from "./filesystemSearchOptions";

export const FILESYSTEM_THUMBNAIL_SIZE_STEPS = [22, 32, 48, 64, 96, 128, 192, 256];
export const DEFAULT_FILESYSTEM_THUMBNAIL_SIZE = FILESYSTEM_THUMBNAIL_SIZE_STEPS[0];

export const FILESYSTEM_VIEW_TYPES = ["folder-tree", "details", "grid", "foldable-grid"];
export const DEFAULT_FILESYSTEM_VIEW_TYPE = "folder-tree";

export const FILESYSTEM_SORT_KEYS = ["name", "modified", "size", "type"];
export const DEFAULT_FILESYSTEM_SORT_KEY = "name";

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
    ...normalizeFilesystemViewStyle(state),
    searchOptions: normalizeSearchOptions(state.searchOptions),
  };
}

// View type, thumbnail size and sort travel together: they are saved per workspace pane and per folder.
export function normalizeFilesystemViewStyle(style = {}, fallback = {}) {
  const pick = (value, isValid, fallbackValue) => (isValid(value) ? value : fallbackValue);
  return {
    thumbnailSizePx: pick(
      style.thumbnailSizePx,
      (size) => FILESYSTEM_THUMBNAIL_SIZE_STEPS.includes(size),
      fallback.thumbnailSizePx ?? DEFAULT_FILESYSTEM_THUMBNAIL_SIZE,
    ),
    viewType: pick(
      style.viewType,
      (viewType) => FILESYSTEM_VIEW_TYPES.includes(viewType),
      fallback.viewType ?? DEFAULT_FILESYSTEM_VIEW_TYPE,
    ),
    sortKey: pick(
      style.sortKey,
      (sortKey) => FILESYSTEM_SORT_KEYS.includes(sortKey),
      fallback.sortKey ?? DEFAULT_FILESYSTEM_SORT_KEY,
    ),
    sortDescending: pick(
      style.sortDescending,
      (sortDescending) => typeof sortDescending === "boolean",
      fallback.sortDescending ?? false,
    ),
  };
}
