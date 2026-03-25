import { getPrimarySelectedPath, getSelectedPathsFromState } from "../utils/pathSelection";

function getPathDisplayName(path) {
  if (typeof path !== "string" || !path) return "";

  const trimmedPath = path.replace(/[\\/]+$/, "");
  if (!trimmedPath) return path;

  const pathSegments = trimmedPath.split(/[\\/]/);
  return pathSegments[pathSegments.length - 1] ?? trimmedPath;
}

export function getPanelSelectedFilesLabel(baseLabel, selectedFiles = {}) {
  const normalizedBaseLabel = typeof baseLabel === "string" ? baseLabel : "";
  const joinLabel = (value) => {
    if (typeof value !== "string" || !value) return normalizedBaseLabel;
    if (!normalizedBaseLabel) return value;
    return `${normalizedBaseLabel}: ${value}`;
  };

  const selectedPaths = getSelectedPathsFromState(selectedFiles);
  const selectedCount = selectedPaths.length;
  if (selectedCount === 0) return normalizedBaseLabel;
  if (selectedCount > 1) return joinLabel(String(selectedCount));

  const fileName = getPathDisplayName(getPrimarySelectedPath(selectedPaths));
  return joinLabel(fileName);
}
