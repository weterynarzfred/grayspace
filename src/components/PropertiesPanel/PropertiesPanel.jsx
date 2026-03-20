import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import { getPanelSelectedFilesLabel } from "../selectedFilesLabel";

function PropertiesPanel({
  panelType = "Properties",
  onPanelTypeChange = undefined,
  tabSelectedFiles = undefined,
}) {
  const propertiesLabel = getPanelSelectedFilesLabel("Properties panel", tabSelectedFiles);

  return (
    <section className={shellStyles.panelContent} aria-label="Properties panel">
      <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange} />
      <div className={shellStyles.panelBody}>{propertiesLabel}</div>
    </section>
  );
}

export default PropertiesPanel;
