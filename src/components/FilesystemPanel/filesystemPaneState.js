import { getSelectedPathsFromState } from "../../utils/pathSelection";

export function arePathArraysEqual(leftPaths = [], rightPaths = []) {
  if (leftPaths.length !== rightPaths.length) {
    return false;
  }

  return leftPaths.every((path, index) => path === rightPaths[index]);
}

export function normalizeFilesystemPaneState(filesystemState = {}) {
  const state = filesystemState ?? {};
  const selectedPaths = getSelectedPathsFromState(state);

  return {
    currentDrive: typeof state.currentDrive === "string" ? state.currentDrive : "",
    currentPath: typeof state.currentPath === "string" ? state.currentPath : "",
    selectedPaths,
    scrollTop: Number.isFinite(state.scrollTop) ? Math.max(0, Math.round(state.scrollTop)) : 0,
  };
}
