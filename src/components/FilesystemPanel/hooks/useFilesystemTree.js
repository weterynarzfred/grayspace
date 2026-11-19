import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSamePath, normalizePathForComparison } from "../../../utils/pathWatch";
import useFilesystemDirectoryWatcher from "./useFilesystemDirectoryWatcher";

function flattenEntries({
  rootEntries,
  expandedByPath,
  directoryEntriesByPath,
  loadingPaths,
  rootPath,
  showHidden,
}) {
  const rows = [];

  function walk(entries, depth, parentPath) {
    entries.forEach((entry) => {
      // Root entries come already filtered by the backend; children are listed in full.
      if (!showHidden && entry?.is_hidden) return;
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

function getPathName(path) {
  if (typeof path !== "string" || !path) return "";

  const trimmedPath = path.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(trimmedPath.lastIndexOf("\\"), trimmedPath.lastIndexOf("/"));
  if (separatorIndex < 0) return trimmedPath;
  return trimmedPath.slice(separatorIndex + 1);
}

function replacePathPrefix(path, sourcePath, destinationPath) {
  if (typeof path !== "string" || !path) return path;

  const normalizedPath = normalizePathForComparison(path);
  const normalizedSourcePath = normalizePathForComparison(sourcePath);
  if (!normalizedPath || !normalizedSourcePath) return path;

  if (normalizedPath === normalizedSourcePath) return destinationPath;
  if (!normalizedPath.startsWith(`${normalizedSourcePath}/`)) return path;

  const normalizedSuffix = normalizedPath.slice(normalizedSourcePath.length + 1);
  const normalizedDestinationPath = destinationPath.replace(/[\\/]+$/, "");
  const separator = normalizedDestinationPath.includes("\\") ? "\\" : "/";
  return `${normalizedDestinationPath}${separator}${normalizedSuffix.replaceAll("/", separator)}`;
}

function remapPathMap(pathMap, sourcePath, destinationPath) {
  let hasChanges = false;
  const nextPathMap = {};

  Object.entries(pathMap).forEach(([path, value]) => {
    const remappedPath = replacePathPrefix(path, sourcePath, destinationPath);
    if (remappedPath !== path) hasChanges = true;
    nextPathMap[remappedPath] = value;
  });

  return hasChanges ? nextPathMap : pathMap;
}

function remapDirectoryEntries(directoryEntriesByPath, sourcePath, destinationPath) {
  let hasAnyChanges = false;
  const nextDirectoryEntriesByPath = {};

  Object.entries(directoryEntriesByPath).forEach(([directoryPath, entries]) => {
    const remappedDirectoryPath = replacePathPrefix(directoryPath, sourcePath, destinationPath);
    if (remappedDirectoryPath !== directoryPath) hasAnyChanges = true;

    let hasEntryChanges = false;
    const remappedEntries = entries.map((entry) => {
      const remappedEntryPath = replacePathPrefix(entry.path, sourcePath, destinationPath);
      if (remappedEntryPath === entry.path) return entry;
      hasEntryChanges = true;

      const remappedName = isSamePath(entry.path, sourcePath)
        ? getPathName(remappedEntryPath) || entry.name
        : entry.name;
      return {
        ...entry,
        name: remappedName,
        path: remappedEntryPath,
      };
    });

    if (hasEntryChanges) hasAnyChanges = true;
    nextDirectoryEntriesByPath[remappedDirectoryPath] = hasEntryChanges
      ? remappedEntries
      : entries;
  });

  return hasAnyChanges ? nextDirectoryEntriesByPath : directoryEntriesByPath;
}

export default function useFilesystemTree({
  currentPath = "",
  rootEntries = [],
  initialExpandedPaths = [],
  onExpandedPathsChange = undefined,
  sortKey = "name",
  sortDescending = false,
  showHidden = true,
}) {
  const [expandedByPath, setExpandedByPath] = useState(() => (
    buildExpandedByPath(initialExpandedPaths, currentPath)
  ));
  const [directoryEntriesByPath, setDirectoryEntriesByPath] = useState({});
  const [loadingByPath, setLoadingByPath] = useState({});
  const lastRootPathRef = useRef(currentPath);
  const directoryEntriesByPathRef = useRef(directoryEntriesByPath);
  directoryEntriesByPathRef.current = directoryEntriesByPath;
  const listedSortRef = useRef({ sortKey, sortDescending });

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
      const loadedEntries = await invoke("list_directory", { path: directoryPath, sortKey, sortDescending });
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
  }, [directoryEntriesByPath, loadingByPath, sortDescending, sortKey]);

  // Re-fetches a cached folder in place, so its rows stay on screen instead of "Loading...". A
  // folder dropped from the cache meanwhile (root change, rename) stays dropped. The sort comes
  // from the ref: a caller may hold a closure from before a sort change (see expandDirectory).
  const relistDirectory = useCallback(async (directoryPath) => {
    const listedEntries = await invoke("list_directory", { path: directoryPath, ...listedSortRef.current })
      .catch(() => []);
    setDirectoryEntriesByPath((prev) => (
      prev[directoryPath] ? { ...prev, [directoryPath]: listedEntries } : prev
    ));
  }, []);

  useEffect(() => {
    const listedSort = listedSortRef.current;
    if (listedSort.sortKey === sortKey && listedSort.sortDescending === sortDescending) return;
    listedSortRef.current = { sortKey, sortDescending };
    Object.keys(directoryEntriesByPathRef.current).forEach(relistDirectory);
  }, [relistDirectory, sortDescending, sortKey]);

  const toggleDirectoryExpanded = useCallback((directoryPath) => {
    if (!directoryPath) return;

    const isOpening = expandedByPath[directoryPath] !== true;
    setExpandedByPath((prev) => {
      if (prev[directoryPath] !== true) return { ...prev, [directoryPath]: true };
      const next = { ...prev };
      delete next[directoryPath];
      return next;
    });
    // A closed folder isn't watched, so its cached listing may be out of date. Uncached folders
    // load through the effect below.
    if (isOpening && directoryEntriesByPath[directoryPath]) relistDirectory(directoryPath);
  }, [directoryEntriesByPath, expandedByPath, relistDirectory]);
  // Opens the folder something was just created in, also when the user opened it during the
  // create, but not once it is outside the current folder. The caller's closure predates the
  // create, hence the refs. A cached listing does too, so it is fetched again.
  const expandDirectory = useCallback((directoryPath) => {
    if (!isPathInsideRoot(directoryPath, lastRootPathRef.current)) return;
    setExpandedByPath((prev) => (prev[directoryPath] ? prev : { ...prev, [directoryPath]: true }));
    if (directoryEntriesByPathRef.current[directoryPath]) relistDirectory(directoryPath);
  }, [relistDirectory]);
  const remapRenamedPath = useCallback((sourcePath, destinationPath) => {
    if (!sourcePath || !destinationPath) return;
    if (isSamePath(sourcePath, destinationPath)) return;

    setExpandedByPath(prev => remapPathMap(prev, sourcePath, destinationPath));
    setDirectoryEntriesByPath(prev => remapDirectoryEntries(prev, sourcePath, destinationPath));
    setLoadingByPath(prev => remapPathMap(prev, sourcePath, destinationPath));
  }, []);

  const expandedDirectoryPaths = useMemo(() => (
    Object.keys(expandedByPath).filter((path) => expandedByPath[path] === true)
  ), [expandedByPath]);

  useEffect(() => {
    expandedDirectoryPaths.forEach((directoryPath) => {
      if (directoryEntriesByPath[directoryPath] || loadingByPath[directoryPath]) return;
      ensureDirectoryEntriesLoaded(directoryPath);
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

    const refreshedEntries = await invoke("list_directory", { path: watchedPath, sortKey, sortDescending });
    setDirectoryEntriesByPath((prev) => ({
      ...prev,
      [watchedPath]: refreshedEntries,
    }));
  }, [expandedByPath, sortDescending, sortKey]);

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
    showHidden,
  }), [currentPath, directoryEntriesByPath, expandedByPath, loadingByPath, rootEntries, showHidden]);

  return {
    treeRows,
    expandedDirectoryPaths,
    toggleDirectoryExpanded,
    expandDirectory,
    remapRenamedPath,
  };
}
