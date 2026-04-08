import { getClassWithColor } from "file-icons-js";

const FILE_ICON_FALLBACK = "text-icon medium-blue";
const DIRECTORY_ICON_FALLBACK = "folder-icon";
const fileIconCache = new Map();

function normalizeIconClassName(value) {
  return String(value ?? "").trim().replaceAll(/\s+/g, " ");
}

export function resolveFilesystemIconClass(entryName = "", { isDirectory = false } = {}) {
  if (isDirectory) return DIRECTORY_ICON_FALLBACK;

  const normalizedName = String(entryName ?? "").trim();
  if (!normalizedName) return FILE_ICON_FALLBACK;

  const cacheKey = normalizedName.toLowerCase();
  const cached = fileIconCache.get(cacheKey);
  if (cached) return cached;

  const resolvedClassName = normalizeIconClassName(
    getClassWithColor(normalizedName) ?? FILE_ICON_FALLBACK,
  );
  fileIconCache.set(cacheKey, resolvedClassName);
  return resolvedClassName;
}

