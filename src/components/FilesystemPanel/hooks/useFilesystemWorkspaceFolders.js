import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

function mapsAreEqual(a, b) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

export default function useFilesystemWorkspaceFolders({ entries = [], paths = [] }) {
  const directoryPaths = useMemo(() => {
    const nextDirectoryPathSet = new Set();

    entries
      .filter((entry) => entry?.is_dir && typeof entry?.path === "string" && entry.path)
      .forEach((entry) => {
        nextDirectoryPathSet.add(entry.path);
      });
    paths
      .filter((path) => typeof path === "string" && path)
      .forEach((path) => {
        nextDirectoryPathSet.add(path);
      });

    return Array.from(nextDirectoryPathSet);
  }, [entries, paths]);
  const directoryPathsKey = useMemo(() => directoryPaths.join("\u0000"), [directoryPaths]);
  const [workspaceByPath, setWorkspaceByPath] = useState({});

  useEffect(() => {
    const trackedPaths = directoryPathsKey ? directoryPathsKey.split("\u0000") : [];
    setWorkspaceByPath((previous) => {
      const next = {};
      trackedPaths.forEach((path) => {
        if (previous[path] === undefined) return;
        next[path] = previous[path];
      });
      return mapsAreEqual(previous, next) ? previous : next;
    });
  }, [directoryPathsKey]);

  const unresolvedPaths = useMemo(() => directoryPaths.filter(
    (path) => workspaceByPath[path] === undefined,
  ), [directoryPaths, workspaceByPath]);
  const unresolvedPathsKey = useMemo(() => unresolvedPaths.join("\u0000"), [unresolvedPaths]);

  useEffect(() => {
    const unresolvedPaths = unresolvedPathsKey ? unresolvedPathsKey.split("\u0000") : [];
    let isCancelled = false;
    if (unresolvedPaths.length === 0) return undefined;

    async function resolveWorkspaceFolders() {
      try {
        const resolved = await invoke("filesystem_resolve_workspace_folders", {
          paths: unresolvedPaths,
        });
        if (isCancelled || typeof resolved !== "object" || resolved === null) return;

        setWorkspaceByPath((previous) => {
          const next = { ...previous };
          Object.entries(resolved).forEach(([path, isWorkspace]) => {
            if (next[path] === isWorkspace) return;
            next[path] = isWorkspace;
          });
          return mapsAreEqual(previous, next) ? previous : next;
        });
      } catch {
        if (isCancelled) return;
        const fallback = {};
        unresolvedPaths.forEach((path) => {
          fallback[path] = false;
        });
        setWorkspaceByPath((previous) => {
          const next = { ...previous };
          Object.entries(fallback).forEach(([path, isWorkspace]) => {
            if (next[path] === isWorkspace) return;
            next[path] = isWorkspace;
          });
          return mapsAreEqual(previous, next) ? previous : next;
        });
      }
    }

    void resolveWorkspaceFolders();

    return () => {
      isCancelled = true;
    };
  }, [unresolvedPathsKey]);

  return useMemo(() => {
    const workspaceFolderPathSet = new Set();
    directoryPaths.forEach((path) => {
      if (workspaceByPath[path] === true) {
        workspaceFolderPathSet.add(path);
      }
    });
    return workspaceFolderPathSet;
  }, [directoryPaths, workspaceByPath]);
}
