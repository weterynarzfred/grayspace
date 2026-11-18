import {
  areSearchOptionsEqual,
  DEFAULT_SEARCH_OPTIONS,
  DEFAULT_SKIPPED_FOLDER_NAMES,
  isSkippingFolders,
  normalizeSearchOptions,
  parseFolderNames,
  toBackendSearchOptions,
} from "./filesystemSearchOptions";
import { normalizeFilesystemPaneState } from "./filesystemPaneState";

describe("filesystemSearchOptions", () => {
  it("falls back to the defaults for missing or invalid values", () => {
    expect(normalizeSearchOptions(undefined)).toEqual(DEFAULT_SEARCH_OPTIONS);
    expect(normalizeSearchOptions(null)).toEqual(DEFAULT_SEARCH_OPTIONS);
    expect(normalizeSearchOptions({
      useRegex: "yes",
      skipFolders: 1,
      skipFolderNames: "node_modules",
      skipCacheDirTagged: null,
    })).toEqual(DEFAULT_SEARCH_OPTIONS);
    expect(normalizeFilesystemPaneState({}).searchOptions).toEqual(DEFAULT_SEARCH_OPTIONS);
  });

  it("keeps saved values, including an emptied skip list, and tidies the names", () => {
    expect(normalizeSearchOptions({
      useRegex: true,
      skipFolders: false,
      skipFolderNames: [" target ", "", 7, "dist"],
      skipCacheDirTagged: true,
    })).toEqual({
      useRegex: true,
      skipFolders: false,
      skipFolderNames: ["target", "dist"],
      skipCacheDirTagged: true,
    });
    expect(normalizeSearchOptions({ skipFolderNames: [] }).skipFolderNames).toEqual([]);
  });

  it("parses comma-separated folder names", () => {
    expect(parseFolderNames(" node_modules, ,dist ,  ")).toEqual(["node_modules", "dist"]);
    expect(parseFolderNames("")).toEqual([]);
  });

  it("compares options by value", () => {
    const copy = { ...DEFAULT_SEARCH_OPTIONS, skipFolderNames: [...DEFAULT_SKIPPED_FOLDER_NAMES] };
    expect(areSearchOptionsEqual(DEFAULT_SEARCH_OPTIONS, copy)).toBe(true);
    expect(areSearchOptionsEqual(DEFAULT_SEARCH_OPTIONS, { ...copy, skipFolderNames: [".git"] })).toBe(false);
    expect(areSearchOptionsEqual(DEFAULT_SEARCH_OPTIONS, { ...copy, useRegex: true })).toBe(false);
  });

  it("sends an empty skip list to the backend when skipping is switched off", () => {
    expect(toBackendSearchOptions(DEFAULT_SEARCH_OPTIONS)).toEqual({
      useRegex: false,
      skipFolderNames: DEFAULT_SKIPPED_FOLDER_NAMES,
      skipCacheDirTagged: false,
    });
    expect(toBackendSearchOptions({ ...DEFAULT_SEARCH_OPTIONS, skipFolders: false }).skipFolderNames).toEqual([]);
  });

  it("knows when a search skips folders", () => {
    expect(isSkippingFolders(DEFAULT_SEARCH_OPTIONS)).toBe(true);
    expect(isSkippingFolders({ ...DEFAULT_SEARCH_OPTIONS, skipFolders: false })).toBe(false);
    expect(isSkippingFolders({ ...DEFAULT_SEARCH_OPTIONS, skipFolderNames: [] })).toBe(false);
    expect(isSkippingFolders({ ...DEFAULT_SEARCH_OPTIONS, skipFolders: false, skipCacheDirTagged: true })).toBe(true);
  });
});
