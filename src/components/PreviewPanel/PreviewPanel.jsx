import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import { getPanelSelectedFilesLabel } from "../selectedFilesLabel";

function PreviewPanel({
  panelType = "Preview",
  onPanelTypeChange = undefined,
  tabSelectedFiles = undefined,
}) {
  const previewLabel = getPanelSelectedFilesLabel("Preview panel", tabSelectedFiles);

  return (
    <section className={shellStyles.panelContent} aria-label="Preview panel">
      <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange} />
      <div className={shellStyles.panelBody}>{previewLabel}</div>
    </section>
  );
}

export default PreviewPanel;
