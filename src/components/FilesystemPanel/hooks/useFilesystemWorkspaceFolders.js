import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";

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
  const pendingPathSetRef = useRef(new Set());

  const unresolvedPaths = useMemo(() => directoryPaths.filter(
    path => workspaceByPath[path] === undefined && !pendingPathSetRef.current.has(path),
  ), [directoryPaths, workspaceByPath]);

  useEffect(() => {
    if (unresolvedPaths.length === 0) return undefined;
    unresolvedPaths.forEach(path => pendingPathSetRef.current.add(path));

    function updateWorkspaceFlags(nextFlags = {}) {
      setWorkspaceByPath((previous) => {
        const next = { ...previous };
        let hasChanged = false;

        for (const path of unresolvedPaths) {
          const nextValue = Boolean(nextFlags[path]);
          if (next[path] === nextValue) continue;
          next[path] = nextValue;
          hasChanged = true;
        }

        return hasChanged ? next : previous;
      });
    }

    async function resolveWorkspaceFolders() {
      try {
        const resolved = await invoke("filesystem_resolve_workspace_folders", {
          paths: unresolvedPaths,
        });
        updateWorkspaceFlags(resolved ?? {});
      } catch {
        updateWorkspaceFlags({});
      } finally {
        unresolvedPaths.forEach(path => pendingPathSetRef.current.delete(path));
      }
    }

    resolveWorkspaceFolders();
  }, [unresolvedPaths]);

  return useMemo(() => {
    const workspaceFolderPathSet = new Set();
    directoryPaths.forEach(path => {
      if (workspaceByPath[path] === true) workspaceFolderPathSet.add(path);
    });
    return workspaceFolderPathSet;
  }, [directoryPaths, workspaceByPath]);
}
