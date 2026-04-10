import { invoke } from "@tauri-apps/api/core";
import { jsonrepair } from "jsonrepair";
import { useEffect, useState } from "react";

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseWorkspaceScripts(rawFolderConfig) {
  const normalizedConfig = trimString(rawFolderConfig);
  if (!normalizedConfig) return [];

  try {
    const repairedConfig = jsonrepair(normalizedConfig);
    const parsedConfig = JSON.parse(repairedConfig);
    const scriptsValue = parsedConfig?.scripts;
    if (!scriptsValue || typeof scriptsValue !== "object" || Array.isArray(scriptsValue)) {
      return [];
    }

    return Object.entries(scriptsValue)
      .filter(([name, command]) => trimString(name) && trimString(command))
      .map(([name, command]) => ({
        name: trimString(name),
        command: trimString(command),
      }));
  } catch {
    return [];
  }
}

export default function useWorkspaceScripts(workspaceRoot = "") {
  const [scripts, setScripts] = useState([]);
  const normalizedWorkspaceRoot = trimString(workspaceRoot);

  useEffect(() => {
    let isDisposed = false;

    async function loadWorkspaceScripts() {
      if (!normalizedWorkspaceRoot) {
        setScripts([]);
        return;
      }

      try {
        const rawFolderConfig = await invoke("workspace_read_folder_config", {
          workspaceRoot: normalizedWorkspaceRoot,
        });
        if (isDisposed) return;
        setScripts(parseWorkspaceScripts(rawFolderConfig));
      } catch {
        if (isDisposed) return;
        setScripts([]);
      }
    }

    loadWorkspaceScripts();
    return () => {
      isDisposed = true;
    };
  }, [normalizedWorkspaceRoot]);

  return scripts;
}
