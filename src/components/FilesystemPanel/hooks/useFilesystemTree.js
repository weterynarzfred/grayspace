import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import useFilesystemDirectoryWatcher from "./useFilesystemDirectoryWatcher";

function flattenEntries({
  rootEntries,
  expandedByPath,
  directoryEntriesByPath,
  loadingPaths,
  rootPath,
}) {
  const rows = [];

  function walk(entries, depth, parentPath) {
    entries.forEach((entry) => {
      const isDirectory = Boolean(entry?.is_dir);
      const entryPath = typeof entry?.path === "string" ? entry.path : "";
      const isExpanded = isDirectory && expandedByPath[entryPath] === true;
      const cachedChildren = directoryEntriesByPath[entryPath] ?? [];
      const isLoadingChildren = isExpanded && loadingPaths[entryPath] === true;

      rows.push({
        entry,
        depth,
        parentPath,
        isExpanded,
        isLoadingChildren,
      });

      if (isExpanded && cachedChildren.length > 0) {
        walk(cachedChildren, depth + 1, entryPath);
      }
    });
  }

  walk(rootEntries, 0, rootPath);
  return rows;
}

export default function useFilesystemTree({
  currentPath = "",
  rootEntries = [],
}) {
  const [expandedByPath, setExpandedByPath] = useState({});
  const [directoryEntriesByPath, setDirectoryEntriesByPath] = useState({});
  const [loadingByPath, setLoadingByPath] = useState({});

  useEffect(() => {
    setExpandedByPath({});
    setDirectoryEntriesByPath({});
    setLoadingByPath({});
  }, [currentPath]);

  const ensureDirectoryEntriesLoaded = useCallback(async (directoryPath) => {
    if (!directoryPath) return;
    if (directoryEntriesByPath[directoryPath] || loadingByPath[directoryPath]) return;

    setLoadingByPath((prev) => ({
      ...prev,
      [directoryPath]: true,
    }));

    try {
      const loadedEntries = await invoke("list_directory", { path: directoryPath });
      setDirectoryEntriesByPath((prev) => ({
        ...prev,
        [directoryPath]: loadedEntries,
      }));
    } catch {
      setDirectoryEntriesByPath((prev) => ({
        ...prev,
        [directoryPath]: [],
      }));
    } finally {
      setLoadingByPath((prev) => {
        if (!prev[directoryPath]) return prev;
        const next = { ...prev };
        delete next[directoryPath];
        return next;
      });
    }
  }, [directoryEntriesByPath, loadingByPath]);

  const toggleDirectoryExpanded = useCallback((directoryPath) => {
    if (!directoryPath) return;

    setExpandedByPath((prev) => {
      const isExpanded = prev[directoryPath] === true;
      if (isExpanded) {
        const next = { ...prev };
        delete next[directoryPath];
        return next;
      }

      void ensureDirectoryEntriesLoaded(directoryPath);
      return {
        ...prev,
        [directoryPath]: true,
      };
    });
  }, [ensureDirectoryEntriesLoaded]);

  const expandedDirectoryPaths = useMemo(() => (
    Object.keys(expandedByPath).filter((path) => expandedByPath[path] === true)
  ), [expandedByPath]);

  const refreshExpandedDirectory = useCallback(async (watchedPath) => {
    if (!watchedPath || expandedByPath[watchedPath] !== true) return;

    const refreshedEntries = await invoke("list_directory", { path: watchedPath });
    setDirectoryEntriesByPath((prev) => ({
      ...prev,
      [watchedPath]: refreshedEntries,
    }));
  }, [expandedByPath]);

  useFilesystemDirectoryWatcher({
    watchPaths: expandedDirectoryPaths,
    onDirectoryChange: refreshExpandedDirectory,
  });

  const treeRows = useMemo(() => flattenEntries({
    rootEntries,
    expandedByPath,
    directoryEntriesByPath,
    loadingPaths: loadingByPath,
    rootPath: currentPath,
  }), [currentPath, directoryEntriesByPath, expandedByPath, loadingByPath, rootEntries]);

  return {
    treeRows,
    toggleDirectoryExpanded,
  };
}
