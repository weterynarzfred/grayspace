import { getSelectedPathsFromState } from "./pathSelection";

export function arePathArraysEqual(leftPaths = [], rightPaths = []) {
  if (leftPaths.length !== rightPaths.length) {
    return false;
  }

  return leftPaths.every((path, index) => path === rightPaths[index]);
}

export function normalizeFilesystemPaneState(filesystemState = {}) {
  const state = filesystemState ?? {};
  const selectedPaths = getSelectedPathsFromState(state);
  const selectedPathFromState = typeof state.selectedPath === "string" ? state.selectedPath : "";
  const selectedPath = selectedPaths.includes(selectedPathFromState)
    ? selectedPathFromState
    : (selectedPaths[selectedPaths.length - 1] ?? "");

  return {
    currentDrive: typeof state.currentDrive === "string" ? state.currentDrive : "",
    currentPath: typeof state.currentPath === "string" ? state.currentPath : "",
    selectedPath: typeof selectedPath === "string" ? selectedPath : "",
    selectedPaths,
    scrollTop: Number.isFinite(state.scrollTop) ? Math.max(0, Math.round(state.scrollTop)) : 0,
  };
}
