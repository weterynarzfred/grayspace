function stripWindowsDevicePrefix(path) {
  if (typeof path !== "string" || !path) return "";

  const normalized = path.replace(/\//g, "\\");
  if (normalized.startsWith("\\\\?\\UNC\\")) return `\\\\${normalized.slice(8)}`;
  if (normalized.startsWith("\\\\?\\")) return normalized.slice(4);
  if (normalized.startsWith("\\\\.\\"))
    return normalized.slice(4);
  return path;
}

export function normalizePathForComparison(path) {
  if (typeof path !== "string" || !path.trim()) return "";

  return stripWindowsDevicePrefix(path.trim())
    .trim()
    .replace(/[\\/]+$/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

export function isSamePath(leftPath, rightPath) {
  const normalizedLeft = normalizePathForComparison(leftPath);
  const normalizedRight = normalizePathForComparison(rightPath);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft === normalizedRight;
}

export function getParentDirectoryPath(path) {
  if (typeof path !== "string") return "";

  const normalizedPath = path.trim().replace(/[\\/]+$/, "");
  if (!normalizedPath) return "";

  const separatorIndex = Math.max(
    normalizedPath.lastIndexOf("\\"),
    normalizedPath.lastIndexOf("/"),
  );
  if (separatorIndex < 0) return "";
  if (separatorIndex === 0) return normalizedPath[0];

  if (separatorIndex === 2 && /^[A-Za-z]:/.test(normalizedPath)) {
    return normalizedPath.slice(0, 3);
  }

  return normalizedPath.slice(0, separatorIndex);
}
