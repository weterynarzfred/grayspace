import { getSelectedPathsFromState } from "../../utils/pathSelection";

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
  };
}
