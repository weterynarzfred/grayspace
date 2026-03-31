import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function normalizePathForComparison(path) {
  if (typeof path !== "string" || !path.trim()) return "";
  return path
    .trim()
    .replace(/[\\/]+$/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

function isPathInsideRoot(path, rootPath) {
  const normalizedPath = normalizePathForComparison(path);
  const normalizedRootPath = normalizePathForComparison(rootPath);
  if (!normalizedRootPath) return false;
  return normalizedPath === normalizedRootPath || normalizedPath.startsWith(`${normalizedRootPath}/`);
}

function buildExpandedByPath(expandedPaths, rootPath) {
  const nextExpandedByPath = {};
  if (!Array.isArray(expandedPaths)) return nextExpandedByPath;
  expandedPaths.forEach((path) => {
    if (typeof path !== "string" || !path) return;
    if (!isPathInsideRoot(path, rootPath)) return;
    nextExpandedByPath[path] = true;
  });
  return nextExpandedByPath;
}

function prunePathMapByRoot(pathMap, rootPath) {
  const nextPathMap = {};
  let hasPruned = false;
  Object.entries(pathMap).forEach(([path, value]) => {
    if (!isPathInsideRoot(path, rootPath)) {
      hasPruned = true;
      return;
    }
    nextPathMap[path] = value;
  });
  return hasPruned ? nextPathMap : pathMap;
}

export default function useFilesystemTree({
  currentPath = "",
  rootEntries = [],
  initialExpandedPaths = [],
  onExpandedPathsChange = undefined,
}) {
  const [expandedByPath, setExpandedByPath] = useState(() => (
    buildExpandedByPath(initialExpandedPaths, currentPath)
  ));
  const [directoryEntriesByPath, setDirectoryEntriesByPath] = useState({});
  const [loadingByPath, setLoadingByPath] = useState({});
  const lastRootPathRef = useRef(currentPath);

  useEffect(() => {
    if (lastRootPathRef.current === currentPath) return;
    lastRootPathRef.current = currentPath;
    setExpandedByPath((prev) => prunePathMapByRoot(prev, currentPath));
    setDirectoryEntriesByPath((prev) => prunePathMapByRoot(prev, currentPath));
    setLoadingByPath((prev) => prunePathMapByRoot(prev, currentPath));
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

  useEffect(() => {
    expandedDirectoryPaths.forEach((directoryPath) => {
      if (directoryEntriesByPath[directoryPath] || loadingByPath[directoryPath]) return;
      void ensureDirectoryEntriesLoaded(directoryPath);
    });
  }, [
    directoryEntriesByPath,
    ensureDirectoryEntriesLoaded,
    expandedDirectoryPaths,
    loadingByPath,
  ]);

  useEffect(() => {
    onExpandedPathsChange?.(expandedDirectoryPaths);
  }, [expandedDirectoryPaths, onExpandedPathsChange]);

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
    expandedDirectoryPaths,
    toggleDirectoryExpanded,
  };
}
