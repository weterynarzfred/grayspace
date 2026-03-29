import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import CodeTextPreview from "./CodeTextPreview";
import usePreviewPanelState from "./usePreviewPanelState";
import styles from "./PreviewPanel.module.scss";

function PreviewPanel({
  paneId = "",
  panelType = "Preview",
  onPanelTypeChange = undefined,
  tabSelectedFiles = undefined,
  onPaneDirtyStateChange = undefined,
}) {
  const {
    imagePreviewSrc,
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
