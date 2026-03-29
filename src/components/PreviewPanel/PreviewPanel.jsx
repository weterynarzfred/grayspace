import { invoke } from "@tauri-apps/api/core";
import { useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelsDndHandlers } from "../PanelsDndLayer";
import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import { getPrimarySelectedPath, getSelectedPathsFromState } from "../../utils/pathSelection";
import { getFirstDraggedPathFromDndEvent } from "../dndEventPaths";
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

function getPathDisplayName(path) {
  if (typeof path !== "string" || !path) return "";

  const trimmedPath = path.replace(/[\\/]+$/, "");
  if (!trimmedPath) return path;

  const pathSegments = trimmedPath.split(/[\\/]/);
  return pathSegments[pathSegments.length - 1] ?? trimmedPath;
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
  paneId = "",
  panelType = "Preview",
  onPanelTypeChange = undefined,
  tabSelectedFiles = undefined,
  onPaneDirtyStateChange = undefined,
}) {
  const selectedPreviewPath = useMemo(
    () => getSelectedPreviewPath(tabSelectedFiles),
    [tabSelectedFiles],
  );
  const [lockedPath, setLockedPath] = useState("");
  const [textContent, setTextContent] = useState("");
  const [saveStatus, setSaveStatus] = useState("idle");
  const [saveError, setSaveError] = useState("");
  const [previewState, setPreviewState] = useState(INITIAL_PREVIEW_STATE);
  const latestSaveRequestRef = useRef(0);
  const latestPreviewPathRef = useRef(selectedPreviewPath);
  const isLocked = Boolean(lockedPath);
  const shouldAutoLockToCurrentPath =
    !isLocked
    && saveStatus === "dirty"
    && latestPreviewPathRef.current
    && selectedPreviewPath !== latestPreviewPathRef.current;
  const previewPath = isLocked
    ? lockedPath
    : (shouldAutoLockToCurrentPath ? latestPreviewPathRef.current : selectedPreviewPath);
  const previewDropId = useMemo(() => `preview-drop:${paneId || "preview"}`, [paneId]);
  const previewLabel = useMemo(() => getPathDisplayName(previewPath), [previewPath]);
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

  const handleToggleLock = useCallback(() => {
    if (isLocked) {
      const willSwitchToSelectedPath =
        selectedPreviewPath
        && selectedPreviewPath !== lockedPath
        && saveStatus === "dirty";
      if (willSwitchToSelectedPath) {
        setSaveStatus("idle");
        setSaveError("");
      }
      setLockedPath("");
      return;
    }

    if (!previewPath) return;
    setLockedPath(previewPath);
  }, [isLocked, lockedPath, previewPath, saveStatus, selectedPreviewPath]);

  const {
    isOver: isDropOver,
    setNodeRef: setDropNodeRef,
  } = useDroppable({
    id: previewDropId,
    data: {
      kind: "preview",
      paneId,
    },
  });
  const handleDropPath = useCallback((droppedPath) => {
    if (!droppedPath) return;
    setLockedPath(droppedPath);
  }, []);

  usePanelsDndHandlers({
    onDragEnd: (event) => {
      if (event?.over?.id !== previewDropId) return;
      handleDropPath(getFirstDraggedPathFromDndEvent(event));
    },
  });

  useEffect(() => {
    latestPreviewPathRef.current = previewPath;
  }, [previewPath]);

  useEffect(() => {
    if (!shouldAutoLockToCurrentPath || isLocked) return;
    setLockedPath(latestPreviewPathRef.current);
  }, [isLocked, shouldAutoLockToCurrentPath]);

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

  return <section
    ref={setDropNodeRef}
    className={`${shellStyles.panelContent} ${styles.panelContent} ${isDropOver ? styles.panelDropTarget : ""}`}
    aria-label="Preview panel"
  >
    <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange}>
      {previewLabel ? <p className={styles.previewLabel}>
        {isLocked ? previewLabel : <em>{previewLabel}</em>}
      </p> : null}

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

      {previewPath ? <div className={styles.previewActions}>
        <button
          type="button"
          className={`${styles.lockButton} ${isLocked ? styles.lockButtonLocked : ""}`}
          onClick={handleToggleLock}
        >{isLocked ? "unlock" : "lock"}</button>
        {isTextPreviewReady ? <button
          type="button"
          className={styles.saveButton}
          onClick={handleSaveNow}
          disabled={!isTextEditable || saveStatus === "saving"}
        >save</button> : null}
      </div> : null}
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
