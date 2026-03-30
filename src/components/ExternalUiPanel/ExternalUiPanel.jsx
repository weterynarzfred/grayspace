import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";

function ExternalUiPanel({
  panelType = "External UI",
  onPanelTypeChange = undefined,
}) {
  return <section className={shellStyles.panelContent} aria-label="External UI panel">
    <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange} />
    <div className={shellStyles.panelBody}>External UI panel</div>
  </section>;
}

export default ExternalUiPanel;
