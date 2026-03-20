import { invoke } from "@tauri-apps/api/core";
import { jsonrepair } from "jsonrepair";
import { useCallback, useEffect, useState } from "react";
import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import styles from "./ScriptsPanel.module.scss";

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown scripts error.";
}

function parseScriptsFromFolderConfig(rawConfigText) {
  const repairedConfig = jsonrepair(rawConfigText);
  const parsedConfig = JSON.parse(repairedConfig);
  const scriptsValue = parsedConfig?.scripts;

  if (!scriptsValue || typeof scriptsValue !== "object" || Array.isArray(scriptsValue))
    return [];

  return Object.entries(scriptsValue)
    .filter(([scriptName, command]) =>
      typeof scriptName === "string" &&
      scriptName.trim() &&
      typeof command === "string" &&
      command.trim(),
    )
    .map(([scriptName, command]) => ({
      name: scriptName,
      command,
    }));
}

function ScriptsPanel({
  panelType = "Scripts",
  onPanelTypeChange = undefined,
  cwdHint = "",
  terminalSessionId = "",
}) {
  const [scripts, setScripts] = useState([]);
  const [status, setStatus] = useState("Open a folder to load scripts.");

  useEffect(() => {
    let isDisposed = false;

    const loadScripts = async () => {
      if (!cwdHint) {
        setScripts([]);
        setStatus("Open a folder to load scripts.");
        return;
      }

      setScripts([]);
      setStatus("Loading scripts...");

      try {
        const rawFolderConfig = await invoke("workspace_read_folder_config", {
          workspaceRoot: cwdHint,
        });
        if (isDisposed) return;

        if (typeof rawFolderConfig !== "string" || !rawFolderConfig.trim()) {
          setStatus("No .grayspace/folder.json found in this folder.");
          return;
        }

        const loadedScripts = parseScriptsFromFolderConfig(rawFolderConfig);
        setScripts(loadedScripts);
        setStatus(
          loadedScripts.length
            ? ""
            : "No scripts found in .grayspace/folder.json.",
        );
      } catch (error) {
        if (isDisposed) return;
        setScripts([]);
        setStatus(`Failed to load scripts: ${getErrorMessage(error)}`);
      }
    };

    loadScripts();
    return () => {
      isDisposed = true;
    };
  }, [cwdHint]);

  const handleRunScript = useCallback(async (scriptName, command) => {
    if (!terminalSessionId) {
      setStatus("Terminal session unavailable for this pane.");
      return;
    }

    onPanelTypeChange?.("Terminal");

    try {
      await invoke("terminal_run_command", {
        sessionId: terminalSessionId,
        command,
      });
    } catch (error) {
      setStatus(
        `Failed to run "${scriptName}": ${getErrorMessage(error)}`,
      );
    }
  }, [onPanelTypeChange, terminalSessionId]);

  return (
    <section className={shellStyles.panelContent} aria-label="Scripts panel">
      <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange}>
        <span className={styles.cwdLabel} title={cwdHint || "No folder selected"}>
          {cwdHint || "No folder selected"}
        </span>
      </PanelHeader>
      <div className={`${shellStyles.panelBody} ${styles.panelBody}`}>
        <h2 className={styles.title}>Scripts panel</h2>
        {status ? <p className={styles.status}>{status}</p> : null}
        {scripts.length ? (
          <ul className={styles.scriptList}>
            {scripts.map((script) => (
              <li key={script.name} className={styles.scriptItem}>
                <button
                  type="button"
                  className={styles.scriptButton}
                  onClick={() => handleRunScript(script.name, script.command)}
                >
                  {script.name}
                </button>
                <code className={styles.command}>{script.command}</code>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

export default ScriptsPanel;
