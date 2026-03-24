import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import { getPanelSelectedFilesLabel } from "../selectedFilesLabel";
import styles from "./PreviewPanel.module.scss";

const INITIAL_PREVIEW_STATE = {
  status: "idle",
  preview: null,
  error: "",
};

function getSelectedPreviewPath(selectedFiles = {}) {
  const selectedPath = typeof selectedFiles.selectedPath === "string"
    ? selectedFiles.selectedPath
    : "";
  const selectedPaths = Array.isArray(selectedFiles.selectedPaths)
    ? selectedFiles.selectedPaths.filter((path) => typeof path === "string" && path)
    : [];
  if (selectedPath && selectedPaths.includes(selectedPath)) return selectedPath;
  if (selectedPath) return selectedPath;
  return selectedPaths[selectedPaths.length - 1] ?? "";
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return "Failed to load preview.";
}

function buildImagePreviewSrc(preview) {
  const mimeType = typeof preview?.mimeType === "string"
    ? preview.mimeType
    : (typeof preview?.mime_type === "string" ? preview.mime_type : "");
  const dataBase64 = typeof preview?.dataBase64 === "string"
    ? preview.dataBase64
    : (typeof preview?.data_base64 === "string" ? preview.data_base64 : "");
  if (!mimeType || !dataBase64) return null;
  return `data:${mimeType};base64,${dataBase64}`;
}

function PreviewPanel({
  panelType = "Preview",
  onPanelTypeChange = undefined,
  tabSelectedFiles = undefined,
}) {
  const previewLabel = getPanelSelectedFilesLabel("Preview panel", tabSelectedFiles);
  const previewPath = useMemo(
    () => getSelectedPreviewPath(tabSelectedFiles),
    [tabSelectedFiles],
  );
  const [previewState, setPreviewState] = useState(INITIAL_PREVIEW_STATE);
  const imagePreviewSrc = useMemo(() => {
    if (previewState.status !== "ready" || previewState.preview?.kind !== "image") return null;
    return buildImagePreviewSrc(previewState.preview);
  }, [previewState]);

  useEffect(() => {
    if (!previewPath) {
      setPreviewState(INITIAL_PREVIEW_STATE);
      return undefined;
    }

    let cancelled = false;

    async function loadPreview() {
      setPreviewState({
        status: "loading",
        preview: null,
        error: "",
      });

      try {
        const preview = await invoke("preview_read_file", { path: previewPath });
        if (cancelled) return;
        setPreviewState({
          status: "ready",
          preview,
          error: "",
        });
      } catch (loadError) {
        if (cancelled) return;
        setPreviewState({
          status: "error",
          preview: null,
          error: getErrorMessage(loadError),
        });
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [previewPath]);

  return (
    <section className={shellStyles.panelContent} aria-label="Preview panel">
      <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange} />
      <div className={shellStyles.panelBody}>
        <p className={styles.previewLabel}>{previewLabel}</p>

        {!previewPath ? (
          <p className={styles.muted}>Select a file to preview.</p>
        ) : null}

        {previewPath && previewState.status === "loading" ? (
          <p className={styles.muted}>Loading preview...</p>
        ) : null}

        {previewPath && previewState.status === "error" ? (
          <p className={styles.error}>{previewState.error}</p>
        ) : null}

        {previewPath
          && previewState.status === "ready"
          && previewState.preview?.kind === "text" ? (
            <>
              <pre className={styles.textPreview} data-testid="preview-text-content">
                {previewState.preview.content}
              </pre>
              {previewState.preview.truncated ? (
                <p className={styles.muted}>Preview truncated to 256 KB.</p>
              ) : null}
            </>
          ) : null}

        {previewPath
          && previewState.status === "ready"
          && previewState.preview?.kind === "image" ? (
            imagePreviewSrc ? (
              <img
                className={styles.imagePreview}
                src={imagePreviewSrc}
                alt={`Preview of ${previewLabel}`}
              />
            ) : (
              <p className={styles.muted}>Failed to render image preview.</p>
            )
          ) : null}

        {previewPath
          && previewState.status === "ready"
          && previewState.preview?.kind === "unsupported" ? (
            <p className={styles.muted}>{previewState.preview.reason}</p>
          ) : null}
      </div>
    </section>
  );
}

export default PreviewPanel;
