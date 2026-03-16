import { useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import CanvasPanel from "./components/CanvasPanel/CanvasPanel";
import ExternalUiPanel from "./components/ExternalUiPanel/ExternalUiPanel";
import PanelsDndLayer from "./components/PanelsDndLayer";
import PreviewPanel from "./components/PreviewPanel/PreviewPanel";
import PropertiesPanel from "./components/PropertiesPanel/PropertiesPanel";
import ScriptsPanel from "./components/ScriptsPanel/ScriptsPanel";
import {
  DEFAULT_LEFT_PANEL_TYPE,
  DEFAULT_RIGHT_PANEL_TYPE,
} from "./components/panelTypes";
import TerminalPanel from "./components/TerminalPanel/TerminalPanel";
import FilesystemPanel from "./components/FilesystemPanel/FilesystemPanel";

import styles from "./App.module.scss";

const PANEL_COMPONENT_BY_TYPE = {
  Filesystem: FilesystemPanel,
  Terminal: TerminalPanel,
  Scripts: ScriptsPanel,
  Canvas: CanvasPanel,
  Properties: PropertiesPanel,
  Preview: PreviewPanel,
  "External UI": ExternalUiPanel,
};

function PanelViewport({ panelType, onPanelTypeChange }) {
  const PanelComponent = PANEL_COMPONENT_BY_TYPE[panelType] ?? FilesystemPanel;

  return <PanelComponent
    panelType={panelType}
    onPanelTypeChange={onPanelTypeChange}
  />;
}

function App() {
  const [leftPanelType, setLeftPanelType] = useState(DEFAULT_LEFT_PANEL_TYPE);
  const [rightPanelType, setRightPanelType] = useState(DEFAULT_RIGHT_PANEL_TYPE);

  return (
    <main className={styles.appShell}>
      <PanelsDndLayer>
        <Group orientation="horizontal" className={styles.panelGroup}>
          <Panel defaultSize={50} minSize={320}>
            <PanelViewport
              panelType={leftPanelType}
              onPanelTypeChange={setLeftPanelType}
            />
          </Panel>
          <Separator className={styles.resizeHandle} />
          <Panel defaultSize={50} minSize={320} collapsible>
            <PanelViewport
              panelType={rightPanelType}
              onPanelTypeChange={setRightPanelType}
            />
          </Panel>
        </Group>
      </PanelsDndLayer>
    </main>
  );
}

export default App;
