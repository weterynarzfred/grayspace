import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";

function CanvasPanel({ panelType = "Canvas", onPanelTypeChange = undefined }) {
  return <section className={shellStyles.panelContent} aria-label="Canvas panel">
    <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange} />
    <div className={shellStyles.panelBody}>Canvas panel</div>
  </section>;
}

export default CanvasPanel;
