import { invoke } from "@tauri-apps/api/core";
import { jsonrepair } from "jsonrepair";
import { useEffect, useMemo, useState } from "react";

function getPathDisplayName(path) {
  if (typeof path !== "string" || !path) return "";

  const trimmedPath = path.replace(/[\\/]+$/, "");
  if (!trimmedPath) return path;

  const pathSegments = trimmedPath.split(/[\\/]/).filter(Boolean);
  return pathSegments[pathSegments.length - 1] ?? trimmedPath;
}

function getPaneRootPath(paneState) {
  const path = paneState?.filesystemState?.currentPath;
  return typeof path === "string" ? path : "";
}

function getTabFolderRootPath(tab) {
  const paneStates = tab?.paneStates ?? {};
  if (tab?.activePaneId && paneStates[tab.activePaneId]?.panelType === "Filesystem") {
    const activePanePath = getPaneRootPath(paneStates[tab.activePaneId]);
    if (activePanePath) return activePanePath;
  }

  const firstFilesystemPane = Object.values(paneStates).find(
    (paneState) => paneState?.panelType === "Filesystem" && getPaneRootPath(paneState),
  );
  if (firstFilesystemPane) return getPaneRootPath(firstFilesystemPane);

  return "";
}

function parseWorkspaceNameFromFolderConfig(rawFolderConfig) {
  if (typeof rawFolderConfig !== "string" || !rawFolderConfig.trim()) return "";

  try {
    const repairedConfig = jsonrepair(rawFolderConfig);
    const parsedConfig = JSON.parse(repairedConfig);
    if (typeof parsedConfig?.name !== "string") return "";
    return parsedConfig.name.trim();
  } catch {
    return "";
  }
}

export default function useWorkspaceTabTitles(tabs = []) {
  const [workspaceNameByRoot, setWorkspaceNameByRoot] = useState({});
  const workspaceRoots = useMemo(() => {
    const roots = new Set();
    tabs.forEach((tab) => {
      if (typeof tab?.workspaceRoot === "string" && tab.workspaceRoot.trim()) {
        roots.add(tab.workspaceRoot.trim());
      }
    });
    return Array.from(roots);
  }, [tabs]);

  useEffect(() => {
    setWorkspaceNameByRoot((previous) => {
      const next = {};
      workspaceRoots.forEach((workspaceRoot) => {
        if (previous[workspaceRoot] !== undefined) {
          next[workspaceRoot] = previous[workspaceRoot];
        }
      });

      const previousKeys = Object.keys(previous);
      const nextKeys = Object.keys(next);
      const changed = previousKeys.length !== nextKeys.length
        || nextKeys.some((workspaceRoot) => previous[workspaceRoot] !== next[workspaceRoot]);
      return changed ? next : previous;
    });
  }, [workspaceRoots]);

  useEffect(() => {
    const unresolvedWorkspaceRoots = workspaceRoots.filter(
      (workspaceRoot) => workspaceNameByRoot[workspaceRoot] === undefined,
    );
    if (unresolvedWorkspaceRoots.length === 0) return undefined;

    let isDisposed = false;

    async function loadWorkspaceNames() {
      const resolvedEntries = await Promise.all(unresolvedWorkspaceRoots.map(async (workspaceRoot) => {
        try {
          const rawFolderConfig = await invoke("workspace_read_folder_config", { workspaceRoot });
          return [workspaceRoot, parseWorkspaceNameFromFolderConfig(rawFolderConfig)];
        } catch {
          return [workspaceRoot, ""];
        }
      }));
      if (isDisposed) return;

      setWorkspaceNameByRoot((previous) => {
        const next = { ...previous };
        resolvedEntries.forEach(([workspaceRoot, workspaceName]) => {
          next[workspaceRoot] = workspaceName;
        });
        return next;
      });
    }

    void loadWorkspaceNames();
    return () => {
      isDisposed = true;
    };
  }, [workspaceNameByRoot, workspaceRoots]);

  return useMemo(() => {
    const titleByTabId = {};
    tabs.forEach((tab) => {
      const workspaceRoot = typeof tab?.workspaceRoot === "string"
        ? tab.workspaceRoot.trim()
        : "";
      if (workspaceRoot) {
        const configuredName = workspaceNameByRoot[workspaceRoot];
        const displayName = (typeof configuredName === "string" && configuredName)
          ? configuredName
          : getPathDisplayName(workspaceRoot);
        titleByTabId[tab.tabId] = displayName ? `ws: ${displayName}` : (tab.title ?? "");
        return;
      }

      const folderRootPath = getTabFolderRootPath(tab);
      const folderName = getPathDisplayName(folderRootPath);
      titleByTabId[tab.tabId] = folderName || tab.title || "";
    });
    return titleByTabId;
  }, [tabs, workspaceNameByRoot]);
}
