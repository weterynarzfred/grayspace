export function formatRecentFolderOpenedAtLabel(timestamp) {
  const openedAtMs = Number.isFinite(timestamp) ? timestamp : 0;
  if (openedAtMs <= 0) return "";
  return new Date(openedAtMs).toISOString().slice(0, 10);
}

export function normalizeRecentFolderEntries(entries = []) {
  return entries
    .filter((entry) => typeof entry?.path === "string" && entry.path.trim())
    .map((entry) => ({
      path: entry.path.trim(),
      openedAtMs: Number.isFinite(entry.openedAtMs) ? entry.openedAtMs : 0,
      isWorkspace: entry.isWorkspace === true,
      searchText: entry.path.trim().toLowerCase(),
    }));
}
