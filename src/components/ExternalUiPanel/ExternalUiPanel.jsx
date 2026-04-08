import { invoke } from "@tauri-apps/api/core";
import { jsonrepair } from "jsonrepair";
import { useEffect, useMemo, useState } from "react";
import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import styles from "./ExternalUiPanel.module.scss";

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

function parseExternalUiConfig(rawConfigText) {
  if (typeof rawConfigText !== "string" || !rawConfigText.trim()) {
    return { url: "", status: "No .grayspace/folder.json found." };
  }

  try {
    const repairedConfig = jsonrepair(rawConfigText);
    const parsedConfig = JSON.parse(repairedConfig);
    const externalUiValue = typeof parsedConfig?.externalUI === "string"
      ? parsedConfig.externalUI.trim()
      : "";
    if (!externalUiValue) {
      return { url: "", status: "No externalUI URL found in .grayspace/folder.json." };
    }

    const parsedUrl = new URL(externalUiValue);
    if (!SAFE_PROTOCOLS.has(parsedUrl.protocol)) {
      return { url: "", status: "externalUI URL must use http or https." };
    }

    return { url: parsedUrl.toString(), status: "" };
  } catch {
    return { url: "", status: "Failed to parse .grayspace/folder.json." };
  }
}

function getMissingConfigStatus(tabWorkspaceRoot) {
  return tabWorkspaceRoot
    ? "No .grayspace/folder.json found in this workspace."
    : "No .grayspace/folder.json found in this folder.";
}

function ExternalUiPanel({
  panelType = "External UI",
  onPanelTypeChange = undefined,
  cwdHint = "",
  tabWorkspaceRoot = "",
}) {
  const [externalUiUrl, setExternalUiUrl] = useState("");
  const [status, setStatus] = useState("Open a folder to load external UI.");
  const configRoot = tabWorkspaceRoot || cwdHint;
  const missingConfigStatus = useMemo(
    () => getMissingConfigStatus(tabWorkspaceRoot),
    [tabWorkspaceRoot],
  );

  useEffect(() => {
    let isDisposed = false;

    async function loadExternalUiConfig() {
      if (!configRoot) {
        setExternalUiUrl("");
        setStatus("Open a folder to load external UI.");
        return;
      }

      setExternalUiUrl("");
      setStatus("Loading external UI...");

      try {
        const rawFolderConfig = await invoke("workspace_read_folder_config", {
          workspaceRoot: configRoot,
        });
        if (isDisposed) return;

        if (typeof rawFolderConfig !== "string" || !rawFolderConfig.trim()) {
          setStatus(missingConfigStatus);
          return;
        }

        const { url, status: parsedStatus } = parseExternalUiConfig(rawFolderConfig);
        setExternalUiUrl(url);
        setStatus(parsedStatus);
      } catch (error) {
        if (isDisposed) return;
        setExternalUiUrl("");
        const errorMessage = error instanceof Error ? error.message : String(error);
        setStatus(`Failed to load external UI: ${errorMessage}`);
      }
    }

    loadExternalUiConfig();
    return () => {
      isDisposed = true;
    };
  }, [configRoot, missingConfigStatus]);

  return <section className={`${shellStyles.panelContent} ${styles.panelContent}`} aria-label="External UI panel">
    <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange}>
      <span className={styles.cwdLabel} title={cwdHint || "No folder selected"}>
        {cwdHint || "No folder selected"}
      </span>
    </PanelHeader>
    <div className={`${shellStyles.panelBody} ${styles.panelBody}`}>
      {status ? <p className={styles.status}>{status}</p> : null}
      {externalUiUrl ? <iframe
        title="External UI"
        className={styles.externalFrame}
        src={externalUiUrl}
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads allow-same-origin"
        referrerPolicy="no-referrer"
      /> : null}
    </div>
  </section>;
}

export default ExternalUiPanel;
