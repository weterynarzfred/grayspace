import { useCallback } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import CanvasPanel from "./CanvasPanel/CanvasPanel";
import ExternalUiPanel from "./ExternalUiPanel/ExternalUiPanel";
import FilesystemPanel from "./FilesystemPanel/FilesystemPanel";
import PreviewPanel from "./PreviewPanel/PreviewPanel";
import PropertiesPanel from "./PropertiesPanel/PropertiesPanel";
import ScriptsPanel from "./ScriptsPanel/ScriptsPanel";
import TerminalPanel from "./TerminalPanel/TerminalPanel";
import styles from "./WorkspacePanelLayout.module.scss";

const PANEL_COMPONENT_BY_TYPE = {
  Filesystem: FilesystemPanel,
  Terminal: TerminalPanel,
  Scripts: ScriptsPanel,
  Canvas: CanvasPanel,
  Properties: PropertiesPanel,
  Preview: PreviewPanel,
  "External UI": ExternalUiPanel,
};

function clampSplitPercent(nextSplit) {
  const splitNumber = Number(nextSplit);
  if (!Number.isFinite(splitNumber)) return 50;
  return Math.max(10, Math.min(90, splitNumber));
}

function WorkspacePanelLayout({
  tab,
  cwdHint = "",
  onCurrentPathChange = undefined,
  onPanelTypeChange = undefined,
}) {
  const splitPercent = clampSplitPercent(tab?.layout?.split);
  const leftDefaultSize = splitPercent;
  const rightDefaultSize = 100 - splitPercent;
  const paneStates = tab?.paneStates ?? {};

  const renderPaneViewport = useCallback((pane, paneState) => {
    const panelType = paneState?.panelType ?? "Filesystem";
    const PanelComponent = PANEL_COMPONENT_BY_TYPE[panelType] ?? FilesystemPanel;

    return (
      <PanelComponent
        panelType={panelType}
        onPanelTypeChange={(nextPanelType) => onPanelTypeChange?.(pane, nextPanelType)}
        onCurrentPathChange={onCurrentPathChange}
        cwdHint={cwdHint}
        terminalSessionId={paneState?.terminalSessionId ?? ""}
      />
    );
  }, [cwdHint, onCurrentPathChange, onPanelTypeChange]);

  return <Group orientation="horizontal" className={styles.panelGroup}>
    <Panel defaultSize={leftDefaultSize} minSize={320}>
      {renderPaneViewport("left", paneStates.left)}
    </Panel>
    <Separator className={styles.resizeHandle} />
    <Panel defaultSize={rightDefaultSize} minSize={320} collapsible>
      {renderPaneViewport("right", paneStates.right)}
    </Panel>
  </Group>;
}

export default WorkspacePanelLayout;
