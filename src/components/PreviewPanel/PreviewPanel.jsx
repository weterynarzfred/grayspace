import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import { getPanelSelectedFilesLabel } from "../selectedFilesLabel";
import { getPrimarySelectedPath, getSelectedPathsFromState } from "../../utils/pathSelection";
import CodeTextPreview from "./CodeTextPreview";
import styles from "./PreviewPanel.module.scss";

const INITIAL_PREVIEW_STATE = {
  status: "idle",
  preview: null,
  error: "",
};

function getSelectedPreviewPath(selectedFiles = {}) {
  return getPrimarySelectedPath(getSelectedPathsFromState(selectedFiles));
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  return "Failed to load preview.";
}

function buildImagePreviewSrc(preview) {
  const mimeType = typeof preview?.mimeType === "string" ? preview.mimeType : "";
  const dataBase64 = typeof preview?.dataBase64 === "string" ? preview.dataBase64 : "";
  if (!mimeType || !dataBase64) return null;
  return `data:${mimeType};base64,${dataBase64}`;
}

function PreviewPanel({
  panelType = "Preview",
  onPanelTypeChange = undefined,
  tabSelectedFiles = undefined,
  onPaneDirtyStateChange = undefined,
}) {
  const previewLabel = getPanelSelectedFilesLabel("", tabSelectedFiles);
  const previewPath = useMemo(
    () => getSelectedPreviewPath(tabSelectedFiles),
    [tabSelectedFiles],
  );
  const [previewState, setPreviewState] = useState(INITIAL_PREVIEW_STATE);
  const [textContent, setTextContent] = useState("");
  const [saveStatus, setSaveStatus] = useState("idle");
  const [saveError, setSaveError] = useState("");
  const latestSaveRequestRef = useRef(0);
  const imagePreviewSrc = useMemo(() => {
    if (previewState.status !== "ready" || previewState.preview?.kind !== "image") return null;
    return buildImagePreviewSrc(previewState.preview);
  }, [previewState]);
  const isTextPreviewReady = previewState.status === "ready" && previewState.preview?.kind === "text";
  const isTextEditable = isTextPreviewReady && !previewState.preview?.truncated;

  const saveTextFile = useCallback(async (path, content) => {
    const requestId = latestSaveRequestRef.current + 1;
    latestSaveRequestRef.current = requestId;
    setSaveStatus("saving");
    setSaveError("");

    try {
      await invoke("preview_write_text_file", { path, content });
      if (latestSaveRequestRef.current !== requestId) return;
      setSaveStatus("saved");
    } catch (saveLoadError) {
      if (latestSaveRequestRef.current !== requestId) return;
      setSaveStatus("error");
      setSaveError(getErrorMessage(saveLoadError));
    }
  }, []);

  const handleTextContentChange = useCallback((nextContent) => {
    if (!isTextEditable || !previewPath) return;

    setTextContent(nextContent);
    setSaveStatus("dirty");
    setSaveError("");
  }, [
    isTextEditable,
    previewPath,
  ]);

  const handleSaveNow = useCallback(() => {
    if (!isTextEditable || !previewPath) return;
    void saveTextFile(previewPath, textContent);
  }, [isTextEditable, previewPath, saveTextFile, textContent]);

  useEffect(() => {
    if (!previewPath) {
      latestSaveRequestRef.current += 1;
      setPreviewState(INITIAL_PREVIEW_STATE);
      setTextContent("");
      setSaveStatus("idle");
      setSaveError("");
      return undefined;
    }

    let cancelled = false;
    latestSaveRequestRef.current += 1;
    setSaveStatus("idle");
    setSaveError("");

    async function loadPreview() {
      setPreviewState({
        status: "loading",
        preview: null,
        error: "",
      });

      try {
        const preview = await invoke("preview_read_file", { path: previewPath });
        if (cancelled) return;
        if (preview?.kind === "text" && typeof preview.content === "string") {
          setTextContent(preview.content);
        } else {
          setTextContent("");
        }
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

  const saveStatusMessage = useMemo(() => {
    if (!isTextPreviewReady || !isTextEditable) return "";

    if (saveStatus === "saving") return "Saving...";
    if (saveStatus === "saved") return "Saved.";
    if (saveStatus === "dirty") return "Unsaved changes.";
    if (saveStatus === "error") return saveError || "Failed to save file.";
    return "";
  }, [isTextEditable, isTextPreviewReady, saveError, saveStatus]);
  const hasUnsavedPreviewChanges = isTextEditable && saveStatus === "dirty";

  useEffect(() => {
    if (typeof onPaneDirtyStateChange !== "function") return;

    onPaneDirtyStateChange({
      hasUnsavedChanges: hasUnsavedPreviewChanges,
      scope: "preview-text",
      message: hasUnsavedPreviewChanges
        ? "This preview has unsaved text changes."
        : "",
    });
  }, [hasUnsavedPreviewChanges, onPaneDirtyStateChange]);

  useEffect(() => () => {
    if (typeof onPaneDirtyStateChange !== "function") return;
    onPaneDirtyStateChange({
      hasUnsavedChanges: false,
      scope: "preview-text",
      message: "",
    });
  }, [onPaneDirtyStateChange]);

  return <section className={`${shellStyles.panelContent} ${styles.panelContent}`} aria-label="Preview panel">
    <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange}>
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

      {saveStatusMessage ? (
        <p className={saveStatus === "error" ? styles.error : styles.muted}>{saveStatusMessage}</p>
      ) : null}

      {isTextPreviewReady ? (
        <button
          type="button"
          className={styles.saveButton}
          onClick={handleSaveNow}
          disabled={!isTextEditable || saveStatus === "saving"}
        >
          Save file
        </button>
      ) : null}
    </PanelHeader>
    <div className={`${shellStyles.panelBody} ${styles.panelBody}`}>

      {previewPath
        && previewState.status === "ready"
        && previewState.preview?.kind === "text" ? <>
        <CodeTextPreview
          filePath={previewPath}
          content={textContent}
          className={styles.textPreview}
          readOnly={!isTextEditable}
          onChange={handleTextContentChange}
          onSave={handleSaveNow}
        />
        {previewState.preview.truncated ? <p className={styles.muted}>
          Preview is truncated. Editing is disabled for large files.
        </p> : null}
      </> : null}

      {previewPath
        && previewState.status === "ready"
        && previewState.preview?.kind === "image" ? (
        imagePreviewSrc ? <img
          className={styles.imagePreview}
          src={imagePreviewSrc}
          alt={`Preview of ${previewLabel}`}
        /> : <p className={styles.muted}>Failed to render image preview.</p>
      ) : null}

      {previewPath
        && previewState.status === "ready"
        && previewState.preview?.kind === "unsupported" ? (
        <p className={styles.muted}>{previewState.preview.reason}</p>
      ) : null}
    </div>
  </section>;
}

export default PreviewPanel;
