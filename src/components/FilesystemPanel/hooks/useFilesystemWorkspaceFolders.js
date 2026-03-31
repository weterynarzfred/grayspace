import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

export default function useFilesystemWorkspaceFolders({ entries = [] }) {
  const directoryPaths = useMemo(
    () => entries
      .filter((entry) => entry?.is_dir && typeof entry?.path === "string" && entry.path)
      .map((entry) => entry.path),
    [entries],
  );
  const [workspaceByPath, setWorkspaceByPath] = useState({});

  useEffect(() => {
    let isCancelled = false;
    const unresolvedPaths = directoryPaths.filter(
      (path) => workspaceByPath[path] === undefined,
    );
    if (unresolvedPaths.length === 0) return undefined;

    async function resolveWorkspaceFolders() {
      try {
        const resolved = await invoke("filesystem_resolve_workspace_folders", {
          paths: unresolvedPaths,
        });
        if (isCancelled || typeof resolved !== "object" || resolved === null) return;

        setWorkspaceByPath((prev) => ({ ...prev, ...resolved }));
      } catch {
        if (isCancelled) return;
        const fallback = {};
        unresolvedPaths.forEach((path) => {
          fallback[path] = false;
        });
        setWorkspaceByPath((prev) => ({ ...prev, ...fallback }));
      }
    }

    void resolveWorkspaceFolders();

    return () => {
      isCancelled = true;
    };
  }, [directoryPaths, workspaceByPath]);

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
