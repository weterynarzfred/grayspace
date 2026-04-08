import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import CodeTextPreview from "./CodeTextPreview";
import usePreviewPanelState from "./usePreviewPanelState";
import styles from "./PreviewPanel.module.scss";

function renderHeaderStatus(previewPath, previewState, saveStatusMessage, saveStatus) {
  if (!previewPath) return <p className={styles.muted}>Select a file to preview.</p>;
  if (previewState.status === "loading") return <p className={styles.muted}>Loading preview...</p>;
  if (previewState.status === "error") return <p className={styles.error}>{previewState.error}</p>;
  if (saveStatusMessage) {
    return <p className={saveStatus === "error" ? styles.error : styles.muted}>{saveStatusMessage}</p>;
  }
  return null;
}

function renderMediaPreview(previewKind, previewPath, previewLabel, mediaPreviewSrc) {
  if (previewKind === "image") {
    return mediaPreviewSrc
      ? <img className={styles.imagePreview} src={mediaPreviewSrc} alt={`Preview of ${previewLabel}`} />
      : <p className={styles.muted}>Failed to render image preview.</p>;
  }
  if (previewKind === "video") {
    return mediaPreviewSrc
      ? <video key={previewPath} className={styles.videoPreview} src={mediaPreviewSrc} controls preload="metadata" data-testid="preview-video" />
      : <p className={styles.muted}>Failed to render video preview.</p>;
  }
  if (previewKind === "audio") {
    return mediaPreviewSrc
      ? <audio key={previewPath} className={styles.audioPreview} src={mediaPreviewSrc} controls preload="metadata" data-testid="preview-audio" />
      : <p className={styles.muted}>Failed to render audio preview.</p>;
  }
  return null;
}

function renderPreviewLabel(previewLabel, isLocked) {
  if (!previewLabel) return null;
  return <p className={styles.previewLabel}>{isLocked ? previewLabel : <em>{previewLabel}</em>}</p>;
}

function renderPreviewActions(previewPath, isLocked, isTextPreviewReady, isTextEditable, saveStatus, handleToggleLock, handleSaveNow) {
  if (!previewPath) return null;
  return <div className={styles.previewActions}>
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
  </div>;
}

function renderTextPreview(previewPath, previewState, textContent, isTextEditable, handleTextContentChange, handleSaveNow) {
  if (!previewPath || previewState.status !== "ready" || previewState.preview?.kind !== "text") return null;
  return <>
    <CodeTextPreview
      filePath={previewPath}
      content={textContent}
      className={styles.textPreview}
      readOnly={!isTextEditable}
      onChange={handleTextContentChange}
      onSave={handleSaveNow}
    />
    {previewState.preview?.truncated ? <p className={styles.muted}>
      Preview is truncated. Editing is disabled for large files.
    </p> : null}
  </>;
}

function PreviewPanel({
  paneId = "",
  panelType = "Preview",
  onPanelTypeChange = undefined,
  tabSelectedFiles = undefined,
  onPaneDirtyStateChange = undefined,
}) {
  const {
    mediaPreviewSrc,
    isDropOver,
    isLocked,
    isTextEditable,
    isTextPreviewReady,
    previewLabel,
    previewPath,
    previewState,
    saveStatus,
    saveStatusMessage,
    setDropNodeRef,
    textContent,
    handleSaveNow,
    handleTextContentChange,
    handleToggleLock,
  } = usePreviewPanelState({
    paneId,
    tabSelectedFiles,
    onPaneDirtyStateChange,
  });
  const isReady = previewState.status === "ready";
  const previewKind = previewState.preview?.kind;
  const panelClassName = `${shellStyles.panelContent} ${styles.panelContent} ${isDropOver ? styles.panelDropTarget : ""}`;
  const mediaContent = isReady ? renderMediaPreview(previewKind, previewPath, previewLabel, mediaPreviewSrc) : null;

  return <section
    ref={setDropNodeRef}
    className={panelClassName}
    aria-label="Preview panel"
  >
    <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange}>
      {renderPreviewLabel(previewLabel, isLocked)}
      {renderHeaderStatus(previewPath, previewState, saveStatusMessage, saveStatus)}
      {renderPreviewActions(previewPath, isLocked, isTextPreviewReady, isTextEditable, saveStatus, handleToggleLock, handleSaveNow)}
    </PanelHeader>
    <div className={`${shellStyles.panelBody} ${styles.panelBody}`}>
      {renderTextPreview(previewPath, previewState, textContent, isTextEditable, handleTextContentChange, handleSaveNow)}
      {previewPath && isReady && previewKind !== "text" && mediaContent}
      {previewPath && isReady && previewKind === "unsupported" ? (
        <p className={styles.muted}>{previewState.preview?.reason}</p>
      ) : null}
    </div>
  </section>;
}

export default PreviewPanel;
