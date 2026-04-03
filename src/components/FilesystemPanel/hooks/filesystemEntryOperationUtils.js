export function getPathName(path) {
  if (typeof path !== "string") return "";
  const trimmedPath = path.trim().replace(/[\\/]+$/, "");
  if (!trimmedPath) return "";

  const separatorIndex = Math.max(
    trimmedPath.lastIndexOf("\\"),
    trimmedPath.lastIndexOf("/"),
  );
  return separatorIndex >= 0 ? trimmedPath.slice(separatorIndex + 1) : trimmedPath;
}

export function joinPath(directoryPath, pathName) {
  if (typeof directoryPath !== "string" || typeof pathName !== "string") return "";
  const trimmedDirectoryPath = directoryPath.trim().replace(/[\\/]+$/, "");
  const trimmedPathName = pathName.trim();
  if (!trimmedDirectoryPath || !trimmedPathName) return "";

  if (trimmedDirectoryPath === "/") return `/${trimmedPathName}`;
  if (/^[A-Za-z]:$/.test(trimmedDirectoryPath)) return `${trimmedDirectoryPath}\\${trimmedPathName}`;

  const separator = trimmedDirectoryPath.includes("\\") ? "\\" : "/";
  return `${trimmedDirectoryPath}${separator}${trimmedPathName}`;
}

export function resolveDestinationPath(sourcePath, destinationDir, movedResult) {
  if (typeof movedResult === "string" && movedResult.trim()) return movedResult;
  return joinPath(destinationDir, getPathName(sourcePath));
}

export function normalizeMoveHistoryItems(items = []) {
  return items
    .filter(item =>
      typeof item?.sourcePath === "string"
      && item.sourcePath
      && typeof item?.destinationPath === "string"
      && item.destinationPath,
    )
    .map(item => ({
      sourcePath: item.sourcePath,
      destinationPath: item.destinationPath,
    }));
}
