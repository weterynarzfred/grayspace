import { getParentDirectoryPath, isSamePath } from "../../utils/pathWatch";

// Folder of a search result relative to the searched folder, e.g. "photos\\2024"; "" when directly inside.
export function getResultLocation(entryPath, rootPath) {
  const parentPath = getParentDirectoryPath(entryPath);
  if (isSamePath(parentPath, rootPath)) return "";
  return parentPath.slice(rootPath.replace(/[\\/]+$/, "").length).replace(/^[\\/]+/, "");
}

export function resolveExternalDropDestinationFromPoint(clientPosition, fallbackPath) {
  if (
    !clientPosition
    || typeof document === "undefined"
    || typeof document.elementFromPoint !== "function"
  ) {
    return fallbackPath;
  }

  const hoveredElement = document.elementFromPoint(clientPosition.x, clientPosition.y);
  const dropTargetElement = hoveredElement?.closest?.("[data-drop-destination-path]");
  const destinationPath = dropTargetElement?.dataset.dropDestinationPath ?? "";
  return destinationPath || fallbackPath;
}

export function buildTreeData(treeRows = []) {
  const entries = [];
  const entryByPath = {};
  const entryParentByPath = {};
  const entryPaths = [];
  const entryPathSet = new Set();

  treeRows.forEach((row) => {
    const entry = row.entry;
    entries.push(entry);
    entryByPath[entry.path] = entry;
    entryParentByPath[entry.path] = row.parentPath;
    entryPaths.push(entry.path);
    entryPathSet.add(entry.path);
  });

  return {
    entries,
    entryByPath,
    entryParentByPath,
    entryPaths,
    entryPathSet,
  };
}

