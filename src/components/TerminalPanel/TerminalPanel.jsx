import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";

function TerminalPanel({ panelType = "Terminal", onPanelTypeChange = undefined }) {
  return (
    <section className={shellStyles.panelContent} aria-label="Terminal panel">
      <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange} />
      <div className={shellStyles.panelBody}>Terminal panel</div>
    </section>
  );
}

export default TerminalPanel;
