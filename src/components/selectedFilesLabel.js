function uniqueNonEmptyPaths(paths) {
  if (!Array.isArray(paths)) return [];

  const seen = new Set();
  const uniquePaths = [];
  paths.forEach((path) => {
    if (typeof path !== "string" || !path) return;
    if (seen.has(path)) return;
    seen.add(path);
    uniquePaths.push(path);
  });
  return uniquePaths;
}

function normalizeSelectedFilesState(selectedFiles = {}) {
  const selectedPath = typeof selectedFiles.selectedPath === "string"
    ? selectedFiles.selectedPath
    : "";
  const selectedPaths = uniqueNonEmptyPaths([
    ...(Array.isArray(selectedFiles.selectedPaths) ? selectedFiles.selectedPaths : []),
    selectedPath,
  ]);
  const primaryPath = selectedPaths.includes(selectedPath)
    ? selectedPath
    : (selectedPaths[selectedPaths.length - 1] ?? "");

  return {
    selectedPath: primaryPath,
    selectedPaths,
  };
}

function getPathDisplayName(path) {
  if (typeof path !== "string" || !path) return "";

  const trimmedPath = path.replace(/[\\/]+$/, "");
  if (!trimmedPath) return path;

  const pathSegments = trimmedPath.split(/[\\/]/);
  return pathSegments[pathSegments.length - 1] ?? trimmedPath;
}

export function getPanelSelectedFilesLabel(baseLabel, selectedFiles = {}) {
  const normalizedSelection = normalizeSelectedFilesState(selectedFiles);
  const selectedCount = normalizedSelection.selectedPaths.length;
  if (selectedCount === 0) return baseLabel;
  if (selectedCount > 1) return `${baseLabel}: ${selectedCount}`;

  const selectedFilePath =
    normalizedSelection.selectedPath || normalizedSelection.selectedPaths[0] || "";
  const fileName = getPathDisplayName(selectedFilePath);
  return fileName ? `${baseLabel}: ${fileName}` : baseLabel;
}
