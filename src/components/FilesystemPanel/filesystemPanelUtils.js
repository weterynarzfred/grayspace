export function normalizePathForComparison(path) {
  if (typeof path !== "string" || !path.trim()) return "";
  return path
    .trim()
    .replace(/[\\/]+$/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

export function isPathInsideRoot(path, rootPath) {
  const normalizedPath = normalizePathForComparison(path);
  const normalizedRootPath = normalizePathForComparison(rootPath);
  if (!normalizedRootPath) return false;
  return normalizedPath === normalizedRootPath
    || normalizedPath.startsWith(`${normalizedRootPath}/`);
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
  const destinationPath = dropTargetElement?.getAttribute("data-drop-destination-path") ?? "";
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

