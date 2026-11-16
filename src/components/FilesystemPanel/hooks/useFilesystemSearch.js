import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const FILESYSTEM_SEARCH_EVENT = "filesystem-search-results";
const SEARCH_DEBOUNCE_MS = 250;
const RERUN_DEBOUNCE_MS = 150;
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function createSearchId() {
  return `filesystem-search-${crypto.randomUUID()}`;
}

function getExtension(entry) {
  if (entry.is_dir) return "";
  const dotIndex = entry.name.lastIndexOf(".");
  return dotIndex > 0 ? entry.name.slice(dotIndex + 1) : "";
}

// Mirrors the Rust listing sort: folders first, then the key, then natural name order.
export function sortSearchResults(entries, sortKey, sortDescending) {
  const direction = sortDescending ? -1 : 1;
  const compareByKey = {
    modified: (left, right) => (left.modified_ms ?? -1) - (right.modified_ms ?? -1),
    size: (left, right) => (left.size_bytes ?? -1) - (right.size_bytes ?? -1),
    type: (left, right) => nameCollator.compare(getExtension(left), getExtension(right)),
  }[sortKey];

  return [...entries].sort((left, right) => {
    if (left.is_dir !== right.is_dir) return left.is_dir ? -1 : 1;
    const byKey = compareByKey?.(left, right) || 0;
    return direction * (byKey || nameCollator.compare(left.name, right.name));
  });
}

// Recursive name search under `rootPath`. Results stream in from the backend walker. A refresh
// drops results that no longer exist right away, then reruns the search in the background and
// swaps in its results once it finishes, so renames and new matches show up without a blank list.
export default function useFilesystemSearch({ rootPath = "", sortKey = "name", sortDescending = false }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState("idle");
  const rootPathRef = useRef(rootPath);
  rootPathRef.current = rootPath;
  const queryRef = useRef(query);
  queryRef.current = query;
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const runRef = useRef(null);
  const rerunTimerRef = useRef(null);

  const cancelRun = useCallback(() => {
    const run = runRef.current;
    runRef.current = null;
    if (run) invoke("filesystem_search_cancel", { searchId: run.searchId }).catch(() => {});
  }, []);

  const startRun = useCallback((searchQuery, { isRerun = false } = {}) => {
    cancelRun();
    const run = { searchId: createSearchId(), isRerun, bufferedEntries: [] };
    runRef.current = run;
    if (!isRerun) setResults([]);
    setStatus("running");
    invoke("filesystem_search_start", {
      searchId: run.searchId,
      root: rootPathRef.current,
      query: searchQuery,
    }).catch(() => {
      if (runRef.current !== run) return;
      runRef.current = null;
      setStatus("done");
    });
  }, [cancelRun]);

  useEffect(() => {
    const unlistenPromise = listen(FILESYSTEM_SEARCH_EVENT, ({ payload }) => {
      const run = runRef.current;
      if (!run || payload.searchId !== run.searchId) return;

      if (run.isRerun) {
        run.bufferedEntries.push(...payload.entries);
        if (payload.done) setResults(run.bufferedEntries);
      } else if (payload.entries.length > 0) {
        setResults((previous) => [...previous, ...payload.entries]);
      }
      if (payload.done) {
        runRef.current = null;
        setStatus(payload.truncated ? "truncated" : "done");
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    clearTimeout(rerunTimerRef.current);
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      cancelRun();
      setResults([]);
      setStatus("idle");
      return undefined;
    }
    const timer = setTimeout(() => startRun(trimmedQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [cancelRun, query, startRun]);

  useEffect(() => () => {
    clearTimeout(rerunTimerRef.current);
    cancelRun();
  }, [cancelRun]);

  const refreshResults = useCallback(async () => {
    const checkedPaths = resultsRef.current.map((entry) => entry.path);
    clearTimeout(rerunTimerRef.current);
    rerunTimerRef.current = setTimeout(() => {
      const trimmedQuery = queryRef.current.trim();
      if (trimmedQuery) startRun(trimmedQuery, { isRerun: true });
    }, RERUN_DEBOUNCE_MS);
    if (checkedPaths.length === 0) return;

    const existingPaths = new Set(await invoke("filesystem_existing_paths", { paths: checkedPaths }));
    const missingPaths = new Set(checkedPaths.filter((path) => !existingPaths.has(path)));
    if (missingPaths.size === 0) return;
    setResults((previous) => previous.filter((entry) => !missingPaths.has(entry.path)));
  }, [startRun]);

  const sortedResults = useMemo(
    () => sortSearchResults(results, sortKey, sortDescending),
    [results, sortDescending, sortKey],
  );

  return {
    searchQuery: query,
    setSearchQuery: setQuery,
    isSearchActive: query.trim() !== "",
    searchResults: sortedResults,
    searchStatus: status,
    refreshSearchResults: refreshResults,
  };
}
