import { invoke } from "@tauri-apps/api/core";
import { jsonrepair } from "jsonrepair";
import { useEffect, useMemo, useState } from "react";
import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import styles from "./ExternalUiPanel.module.scss";

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

function parseExternalUiConfig(rawConfigText) {
  if (typeof rawConfigText !== "string" || !rawConfigText.trim()) {
    return {
      url: "",
      status: "No .grayspace/folder.json found.",
      statusKind: "missing-config",
    };
  }

  try {
    const repairedConfig = jsonrepair(rawConfigText);
    const parsedConfig = JSON.parse(repairedConfig);
    const externalUiValue = typeof parsedConfig?.externalUI === "string"
      ? parsedConfig.externalUI.trim()
      : "";
    if (!externalUiValue) {
      return {
        url: "",
        status: "externalUI not set in .grayspace/folder.json.",
        statusKind: "missing-external-ui",
      };
    }

    const parsedUrl = new URL(externalUiValue);
    if (!SAFE_PROTOCOLS.has(parsedUrl.protocol)) {
      return {
        url: "",
        status: "externalUI URL must use http or https.",
        statusKind: "invalid-url",
      };
    }

    return { url: parsedUrl.toString(), status: "", statusKind: "ready" };
  } catch {
    return {
      url: "",
      status: "Failed to parse .grayspace/folder.json.",
      statusKind: "error",
    };
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
  const [statusKind, setStatusKind] = useState("info");
  const [refreshKey, setRefreshKey] = useState(0);
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
        setStatusKind("info");
        return;
      }

      setExternalUiUrl("");
      setStatus("Loading external UI...");
      setStatusKind("loading");

      try {
        const rawFolderConfig = await invoke("workspace_read_folder_config", {
          workspaceRoot: configRoot,
        });
        if (isDisposed) return;

        if (typeof rawFolderConfig !== "string" || !rawFolderConfig.trim()) {
          setStatus(missingConfigStatus);
          setStatusKind("missing-config");
          return;
        }

        const { url, status: parsedStatus, statusKind: parsedStatusKind } = parseExternalUiConfig(rawFolderConfig);
        setExternalUiUrl(url);
        setStatus(parsedStatus);
        setStatusKind(parsedStatusKind);
      } catch (error) {
        if (isDisposed) return;
        setExternalUiUrl("");
        const errorMessage = error instanceof Error ? error.message : String(error);
        setStatus(`Failed to load external UI: ${errorMessage}`);
        setStatusKind("error");
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
      <button
        type="button"
        className={styles.refreshButton}
        title="Refresh external UI"
        aria-label="Refresh external UI"
        onClick={() => setRefreshKey((current) => current + 1)}
        disabled={!externalUiUrl}
      >↻</button>
    </PanelHeader>
    <div className={`${shellStyles.panelBody} ${styles.panelBody}`}>
      {statusKind === "missing-external-ui" ? <div className={styles.emptyState}>
        <h2 className={styles.emptyTitle}>externalUI not set</h2>
        <p className={styles.emptyMessage}>
          Add <code className={styles.inlineCode}>externalUI</code> in <code className={styles.inlineCode}>.grayspace/folder.json</code> to load a page here.
        </p>
      </div> : null}
      {status && statusKind !== "missing-external-ui" ? <p className={styles.status}>{status}</p> : null}
      {externalUiUrl ? <iframe
        key={`${externalUiUrl}::${refreshKey}`}
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
