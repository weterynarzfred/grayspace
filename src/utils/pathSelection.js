export function uniqueNonEmptyPaths(paths) {
  if (!Array.isArray(paths)) {
    return [];
  }

  const seen = new Set();
  const normalizedPaths = [];

  paths.forEach((path) => {
    if (typeof path !== "string" || !path) return;
    if (seen.has(path)) return;
    seen.add(path);
    normalizedPaths.push(path);
  });

  return normalizedPaths;
}

export function getSelectedPathsFromState(state = {}) {
  const selectedPaths = Array.isArray(state?.selectedPaths) ? state.selectedPaths : [];
  return uniqueNonEmptyPaths(selectedPaths);
}

export function getPrimarySelectedPath(paths = []) {
  const normalizedPaths = uniqueNonEmptyPaths(paths);
  return normalizedPaths[normalizedPaths.length - 1] ?? "";
}
