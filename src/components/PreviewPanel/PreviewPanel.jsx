import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";

function PreviewPanel({ panelType = "Preview", onPanelTypeChange = undefined }) {
  return (
    <section className={shellStyles.panelContent} aria-label="Preview panel">
      <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange} />
      <div className={shellStyles.panelBody}>Preview panel</div>
    </section>
  );
}

export default PreviewPanel;
