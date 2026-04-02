import { invoke } from "@tauri-apps/api/core";

export const DIRECTORY_PAGE_SIZE = 120;
export const MAX_REFRESH_ENTRY_COUNT = DIRECTORY_PAGE_SIZE * 3;

function normalizeDirectoryPageResponse(response = {}) {
  const entries = Array.isArray(response.entries) ? response.entries : [];
  const totalCount = Number.isFinite(response.totalCount)
    ? Math.max(entries.length, Math.floor(response.totalCount))
    : entries.length;

  return {
    entries,
    hasMore: response.hasMore === true,
    totalCount,
  };
}

export async function listDirectoryPage(path, offset, limit, options = {}) {
  const response = await invoke("list_directory_page", {
    path,
    offset,
    limit,
    refresh: options.refresh === true,
  });
  return normalizeDirectoryPageResponse(response);
}

