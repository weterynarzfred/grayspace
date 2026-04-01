import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

function mergeWorkspaceByPath(previous, updates) {
  let hasChanged = false;
  const next = { ...previous };
  Object.entries(updates).forEach(([path, isWorkspace]) => {
    const normalizedValue = Boolean(isWorkspace);
    if (next[path] === normalizedValue) return;
    next[path] = normalizedValue;
    hasChanged = true;
  });
  return hasChanged ? next : previous;
}

export default function useFilesystemWorkspaceFolders({ entries = [], paths = [] }) {
  const directoryPaths = useMemo(() => {
    const trackedPathSet = new Set();
    entries.forEach(entry => {
      if (entry?.is_dir && typeof entry.path === "string" && entry.path) {
        trackedPathSet.add(entry.path);
      }
    });
    paths.forEach(path => {
      if (typeof path === "string" && path) trackedPathSet.add(path);
    });
    return Array.from(trackedPathSet);
  }, [entries, paths]);
  const [workspaceByPath, setWorkspaceByPath] = useState({});

  useEffect(() => {
    const trackedPathSet = new Set(directoryPaths);
    setWorkspaceByPath(previous => {
      const next = {};
      let hasChanged = false;
      Object.entries(previous).forEach(([path, isWorkspace]) => {
        if (!trackedPathSet.has(path)) {
          hasChanged = true;
          return;
        }
        next[path] = isWorkspace;
      });
      return hasChanged ? next : previous;
    });
  }, [directoryPaths]);

  const unresolvedPaths = useMemo(() => directoryPaths.filter(
    path => workspaceByPath[path] === undefined,
  ), [directoryPaths, workspaceByPath]);

  useEffect(() => {
    if (unresolvedPaths.length === 0) return undefined;

    let isCancelled = false;
    const fallback = {};
    unresolvedPaths.forEach(path => {
      fallback[path] = false;
    });

    async function resolveWorkspaceFolders() {
      try {
        const resolved = await invoke("filesystem_resolve_workspace_folders", {
          paths: unresolvedPaths,
        });
        if (isCancelled || typeof resolved !== "object" || resolved === null) return;

        setWorkspaceByPath(previous => mergeWorkspaceByPath(previous, resolved));
      } catch {
        if (isCancelled) return;
        setWorkspaceByPath(previous => mergeWorkspaceByPath(previous, fallback));
      }
    }

    void resolveWorkspaceFolders();

    return () => {
      isCancelled = true;
    };
  }, [unresolvedPaths]);

  return useMemo(() => {
    const workspaceFolderPathSet = new Set();
    directoryPaths.forEach(path => {
      if (workspaceByPath[path] === true) workspaceFolderPathSet.add(path);
    });
    return workspaceFolderPathSet;
  }, [directoryPaths, workspaceByPath]);
}
