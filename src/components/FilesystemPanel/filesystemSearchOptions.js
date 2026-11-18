export const DEFAULT_SKIPPED_FOLDER_NAMES = [
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "__pycache__",
  ".venv",
  "$RECYCLE.BIN",
  "System Volume Information",
];

export const DEFAULT_SEARCH_OPTIONS = {
  useRegex: false,
  skipFolders: true,
  skipFolderNames: DEFAULT_SKIPPED_FOLDER_NAMES,
  skipCacheDirTagged: false,
};

export function parseFolderNames(text) {
  return text.split(",").map((name) => name.trim()).filter(Boolean);
}

// Search options are saved with the pane state, so they may come from a hand-edited panels.json.
export function normalizeSearchOptions(options = {}) {
  const state = options ?? {};
  const pickBoolean = (value, fallback) => (typeof value === "boolean" ? value : fallback);
  return {
    useRegex: pickBoolean(state.useRegex, DEFAULT_SEARCH_OPTIONS.useRegex),
    skipFolders: pickBoolean(state.skipFolders, DEFAULT_SEARCH_OPTIONS.skipFolders),
    skipFolderNames: Array.isArray(state.skipFolderNames)
      ? state.skipFolderNames.filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim())
      : DEFAULT_SKIPPED_FOLDER_NAMES,
    skipCacheDirTagged: pickBoolean(state.skipCacheDirTagged, DEFAULT_SEARCH_OPTIONS.skipCacheDirTagged),
  };
}

export function areSearchOptionsEqual(left, right) {
  return left.useRegex === right.useRegex
    && left.skipFolders === right.skipFolders
    && left.skipCacheDirTagged === right.skipCacheDirTagged
    && left.skipFolderNames.length === right.skipFolderNames.length
    && left.skipFolderNames.every((name, index) => name === right.skipFolderNames[index]);
}

// The backend walk gets an empty name list when skipping is switched off.
export function toBackendSearchOptions({ useRegex, skipFolders, skipFolderNames, skipCacheDirTagged }) {
  return { useRegex, skipFolderNames: skipFolders ? skipFolderNames : [], skipCacheDirTagged };
}

export function isSkippingFolders(options) {
  return (options.skipFolders && options.skipFolderNames.length > 0) || options.skipCacheDirTagged;
}
