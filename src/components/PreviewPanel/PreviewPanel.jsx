import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import { isSamePath } from "../../utils/pathWatch";
import CodeTextPreview from "./CodeTextPreview";
import usePreviewPanelState from "./usePreviewPanelState";
import { getPathDisplayName } from "./previewPanelUtils";
import styles from "./PreviewPanel.module.scss";

function renderHeaderStatus(previewPath, previewTabs, previewState, saveStatusMessage, saveStatus) {
  if (previewTabs.length === 0) return <p className={styles.muted}>Select a file to preview.</p>;
  if (!previewPath) return <p className={styles.muted}>Select a tab to preview.</p>;
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

function renderPreviewTabs({
  previewTabs,
  previewPath,
  handlePreviewTabActivate,
  handlePreviewTabClose,
  handlePreviewTabUnpin,
}) {
  if (!Array.isArray(previewTabs) || previewTabs.length === 0) return null;

  return <div className={styles.previewTabs} role="tablist" aria-label="Open preview files">
    {previewTabs.map((tab) => {
      const isActive = isSamePath(tab.path, previewPath);
      const tabLabel = getPathDisplayName(tab.path);
      const dirtySuffix = tab.isDirty ? " *" : "";
      const titleParts = [tab.path];
      if (tab.isEphemeral) titleParts.push("ephemeral");
      if (tab.isDirty) titleParts.push("dirty");
      const renderedTabLabel = tab.isEphemeral
        ? <em className={styles.previewTabLabelEphemeral}>{tabLabel}{dirtySuffix}</em>
        : <>{tabLabel}{dirtySuffix}</>;

      return <div
        key={tab.path}
        className={`${styles.previewTab} ${isActive ? styles.previewTabActive : ""}`}
        data-testid={`preview-tab-${tab.path}`}
      >
        <button
          type="button"
          role="tab"
          aria-selected={isActive}
          className={styles.previewTabSelect}
          title={titleParts.join(" | ")}
          onClick={() => handlePreviewTabActivate(tab.path)}
          onDoubleClick={() => handlePreviewTabUnpin(tab.path)}
        >{renderedTabLabel}</button>
        <button
          type="button"
          className={styles.previewTabClose}
          title={`Close ${tabLabel}`}
          aria-label={`Close ${tabLabel}`}
          onClick={() => handlePreviewTabClose(tab.path)}
        >&times;</button>
      </div>;
    })}
  </div>;
}

function PreviewPanel({
  paneId = "",
  panelType = "Preview",
  onPanelTypeChange = undefined,
  previewPaneState = undefined,
  onOpenPreviewPath = undefined,
  onActivatePreviewTab = undefined,
  onClosePreviewTab = undefined,
  onUpdatePreviewTab = undefined,
  onPaneDirtyStateChange = undefined,
}) {
  const {
    mediaPreviewSrc,
    isDropOver,
    isTextEditable,
    isTextPreviewReady,
    previewTabs,
    previewLabel,
    previewPath,
    previewState,
    saveStatus,
    saveStatusMessage,
    setDropNodeRef,
    textContent,
    handlePreviewTabActivate,
    handlePreviewTabClose,
    handlePreviewTabUnpin,
    handleSaveNow,
    handleTextContentChange,
  } = usePreviewPanelState({
    paneId,
    previewPaneState,
    onOpenPreviewPath,
    onActivatePreviewTab,
    onClosePreviewTab,
    onUpdatePreviewTab,
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
      <div className={styles.headerContent}>
        {renderPreviewTabs({
          previewTabs,
          previewPath,
          handlePreviewTabActivate,
          handlePreviewTabClose,
          handlePreviewTabUnpin,
        })}
        <div className={styles.headerMeta}>
          {renderHeaderStatus(previewPath, previewTabs, previewState, saveStatusMessage, saveStatus)}
          {isTextPreviewReady && previewPath ? <button
            type="button"
            className={styles.saveButton}
            onClick={handleSaveNow}
            disabled={!isTextEditable || saveStatus === "saving"}
          >save</button> : null}
        </div>
      </div>
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
