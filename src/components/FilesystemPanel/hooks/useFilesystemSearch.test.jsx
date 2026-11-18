import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import useFilesystemSearch, { sortSearchResults } from "./useFilesystemSearch";
import { DEFAULT_SEARCH_OPTIONS, DEFAULT_SKIPPED_FOLDER_NAMES } from "../filesystemSearchOptions";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

let emitSearchResults;

function file(name, extra = {}) {
  return { name, path: `C:\\Root\\${name}`, is_dir: false, ...extra };
}

function lastSearchId() {
  return invoke.mock.calls.findLast(([command]) => command === "filesystem_search_start")[1].searchId;
}

function searchStartCount() {
  return invoke.mock.calls.filter(([command]) => command === "filesystem_search_start").length;
}

function resultNames(result) {
  return result.current.searchResults.map((entry) => entry.name);
}

describe("sortSearchResults", () => {
  it("puts folders first and sorts names naturally, sizes and dates numerically", () => {
    const entries = [
      file("img10.png", { size_bytes: 5, modified_ms: 3 }),
      file("img2.png", { size_bytes: 50, modified_ms: 1 }),
      { name: "zeta", path: "C:\\Root\\zeta", is_dir: true },
    ];

    expect(sortSearchResults(entries, "name", false).map((entry) => entry.name))
      .toEqual(["zeta", "img2.png", "img10.png"]);
    expect(sortSearchResults(entries, "size", true).map((entry) => entry.name))
      .toEqual(["zeta", "img2.png", "img10.png"]);
    expect(sortSearchResults(entries, "modified", false).map((entry) => entry.name))
      .toEqual(["zeta", "img2.png", "img10.png"]);
  });
});

describe("useFilesystemSearch", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(null);
    listen.mockReset();
    listen.mockImplementation(async (_eventName, handler) => {
      emitSearchResults = (payload) => act(() => handler({ payload }));
      return () => {};
    });
  });

  it("streams results for the debounced query and ignores batches from older searches", async () => {
    const { result } = renderHook(() => useFilesystemSearch({ rootPath: "C:\\Root" }));

    act(() => result.current.setSearchQuery("im"));
    act(() => result.current.setSearchQuery("img"));
    await waitFor(() => expect(searchStartCount()).toBe(1));
    expect(invoke).toHaveBeenCalledWith("filesystem_search_start", {
      searchId: expect.any(String),
      root: "C:\\Root",
      query: "img",
      options: { useRegex: false, skipFolderNames: DEFAULT_SKIPPED_FOLDER_NAMES, skipCacheDirTagged: false, skipHidden: false },
    });
    const searchId = lastSearchId();

    emitSearchResults({ searchId: "stale", entries: [file("old.png")], done: false, truncated: false });
    emitSearchResults({ searchId, entries: [file("img10.png")], done: false, truncated: false });
    emitSearchResults({ searchId, entries: [file("img2.png")], done: false, truncated: false });

    expect(resultNames(result)).toEqual(["img2.png", "img10.png"]);
    expect(result.current.searchStatus).toBe("running");

    emitSearchResults({ searchId, entries: [], done: true, truncated: true });
    expect(result.current.searchStatus).toBe("truncated");
  });

  it("drops missing results at once and swaps in a background rerun only when it finishes", async () => {
    const { result } = renderHook(() => useFilesystemSearch({ rootPath: "C:\\Root" }));
    act(() => result.current.setSearchQuery("a"));
    await waitFor(() => expect(searchStartCount()).toBe(1));
    emitSearchResults({
      searchId: lastSearchId(),
      entries: [file("a1.txt"), file("a2.txt")],
      done: true,
      truncated: false,
    });

    invoke.mockImplementation(async (command) => (
      command === "filesystem_existing_paths" ? ["C:\\Root\\a1.txt"] : null
    ));
    await act(() => result.current.refreshSearchResults());

    expect(resultNames(result)).toEqual(["a1.txt"]);
    await waitFor(() => expect(searchStartCount()).toBe(2));
    const rerunId = lastSearchId();

    emitSearchResults({ searchId: rerunId, entries: [file("a1.txt")], done: false, truncated: false });
    expect(resultNames(result)).toEqual(["a1.txt"]);
    expect(result.current.searchStatus).toBe("running");

    emitSearchResults({ searchId: rerunId, entries: [file("a3.txt")], done: true, truncated: false });
    expect(resultNames(result)).toEqual(["a1.txt", "a3.txt"]);
    expect(result.current.searchStatus).toBe("done");
  });

  it("reruns the current search with the new options when they change", async () => {
    const { result, rerender } = renderHook(
      ({ searchOptions }) => useFilesystemSearch({ rootPath: "C:\\Root", searchOptions }),
      { initialProps: { searchOptions: DEFAULT_SEARCH_OPTIONS } },
    );
    act(() => result.current.setSearchQuery("src/.*\\.jsx$"));
    await waitFor(() => expect(searchStartCount()).toBe(1));
    const firstSearchId = lastSearchId();

    rerender({
      searchOptions: { ...DEFAULT_SEARCH_OPTIONS, useRegex: true, skipFolders: false, skipCacheDirTagged: true },
    });

    await waitFor(() => expect(searchStartCount()).toBe(2));
    expect(invoke).toHaveBeenCalledWith("filesystem_search_cancel", { searchId: firstSearchId });
    expect(invoke).toHaveBeenLastCalledWith("filesystem_search_start", {
      searchId: expect.any(String),
      root: "C:\\Root",
      query: "src/.*\\.jsx$",
      options: { useRegex: true, skipFolderNames: [], skipCacheDirTagged: true, skipHidden: false },
    });
  });

  it("reruns the current search skipping hidden entries when they get hidden", async () => {
    const { result, rerender } = renderHook(
      ({ showHidden }) => useFilesystemSearch({ rootPath: "C:\\Root", showHidden }),
      { initialProps: { showHidden: true } },
    );
    act(() => result.current.setSearchQuery("config"));
    await waitFor(() => expect(searchStartCount()).toBe(1));
    const firstSearchId = lastSearchId();

    rerender({ showHidden: false });

    await waitFor(() => expect(searchStartCount()).toBe(2));
    expect(invoke).toHaveBeenCalledWith("filesystem_search_cancel", { searchId: firstSearchId });
    expect(invoke).toHaveBeenLastCalledWith("filesystem_search_start", expect.objectContaining({
      query: "config",
      options: expect.objectContaining({ skipHidden: true }),
    }));
  });

  it("ends with an error status carrying the reason when the backend refuses the search", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "filesystem_search_start") throw "Invalid regex: unclosed group";
      return null;
    });
    const searchOptions = { ...DEFAULT_SEARCH_OPTIONS, useRegex: true };
    const { result } = renderHook(() => useFilesystemSearch({ rootPath: "C:\\Root", searchOptions }));

    act(() => result.current.setSearchQuery("a("));

    await waitFor(() => expect(result.current.searchStatus).toBe("error"));
    expect(result.current.searchError).toBe("Invalid regex: unclosed group");
  });

  it("cancels a running search when the query is cleared", async () => {
    const { result } = renderHook(() => useFilesystemSearch({ rootPath: "C:\\Root" }));
    act(() => result.current.setSearchQuery("a"));
    await waitFor(() => expect(searchStartCount()).toBe(1));
    const searchId = lastSearchId();
    emitSearchResults({ searchId, entries: [file("a1.txt")], done: false, truncated: false });

    act(() => result.current.setSearchQuery(""));

    expect(invoke).toHaveBeenCalledWith("filesystem_search_cancel", { searchId });
    expect(result.current.isSearchActive).toBe(false);
    expect(result.current.searchResults).toEqual([]);
    expect(result.current.searchStatus).toBe("idle");
  });
});
