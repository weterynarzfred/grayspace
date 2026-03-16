import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";

function ScriptsPanel({ panelType = "Scripts", onPanelTypeChange = undefined }) {
  return (
    <section className={shellStyles.panelContent} aria-label="Scripts panel">
      <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange} />
      <div className={shellStyles.panelBody}>Scripts panel</div>
    </section>
  );
}

export default ScriptsPanel;
