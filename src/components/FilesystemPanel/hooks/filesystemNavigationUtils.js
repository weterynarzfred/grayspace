import {
  getSelectedPathsFromState,
  uniqueNonEmptyPaths,
} from "../../../utils/pathSelection";

export function sortPathsByEntryOrder(paths, entryPaths) {
  const entryPathIndex = new Map(entryPaths.map((path, index) => [path, index]));
  return uniqueNonEmptyPaths(paths).sort((leftPath, rightPath) => (
    (entryPathIndex.get(leftPath) ?? Number.MAX_SAFE_INTEGER)
    - (entryPathIndex.get(rightPath) ?? Number.MAX_SAFE_INTEGER)
  ));
}

export function getRangeSelectionPaths(entryPaths, startPath, endPath) {
  const startIndex = entryPaths.indexOf(startPath);
  const endIndex = entryPaths.indexOf(endPath);
  if (startIndex === -1 || endIndex === -1) return [];

  const [fromIndex, toIndex] = startIndex <= endIndex
    ? [startIndex, endIndex]
    : [endIndex, startIndex];
  return entryPaths.slice(fromIndex, toIndex + 1);
}

export function normalizeInitialFilesystemState(initialState) {
  const state = initialState ?? {};
  const selectedPaths = getSelectedPathsFromState(state);
  const expandedPaths = uniqueNonEmptyPaths(state.expandedPaths);
  return {
    currentDrive: typeof state.currentDrive === "string" ? state.currentDrive : "",
    currentPath: typeof state.currentPath === "string" ? state.currentPath : "",
    selectedPaths,
    expandedPaths,
    selectionAnchorPath: selectedPaths[selectedPaths.length - 1] ?? "",
  };
}

export function getNavigationErrorMessage(error, fallbackMessage) {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const objectError = [
      error.message,
      error.error,
      error.reason,
      error.details,
    ].find(value => typeof value === "string" && value.trim());
    if (objectError) return objectError.trim();
  }
  return fallbackMessage;
}
