import { Group, Panel, Separator } from "react-resizable-panels";
import PanelsDndLayer from "./components/PanelsDndLayer";
import FilesystemPanel from "./components/FilesystemPanel/FilesystemPanel";

import styles from "./App.module.scss";

function App() {
  return (
    <main className={styles.appShell}>
      <PanelsDndLayer>
        <Group orientation="horizontal" className={styles.panelGroup}>
          <Panel defaultSize={50} minSize={20}>
            <FilesystemPanel />
          </Panel>
          <Separator className={styles.resizeHandle} />
          <Panel defaultSize={50} minSize={20}>
            <section className={styles.panelContent} aria-label="Right panel" />
          </Panel>
        </Group>
      </PanelsDndLayer>
    </main>
  );
}

export default App;
