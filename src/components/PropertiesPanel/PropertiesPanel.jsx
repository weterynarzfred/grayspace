import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";

function PropertiesPanel({
  panelType = "Properties",
  onPanelTypeChange = undefined,
}) {
  return (
    <section className={shellStyles.panelContent} aria-label="Properties panel">
      <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange} />
      <div className={shellStyles.panelBody}>Properties panel</div>
    </section>
  );
}

export default PropertiesPanel;
