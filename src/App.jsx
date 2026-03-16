import { Group, Panel, Separator } from "react-resizable-panels";
import FilesystemPanel from "./components/FilesystemPanel";
import styles from "./App.module.scss";

function App() {
  return (
    <main className={styles.appShell}>
      <Group orientation="horizontal" className={styles.panelGroup}>
        <Panel defaultSize={50} minSize={20}>
          <FilesystemPanel />
        </Panel>
        <Separator className={styles.resizeHandle} />
        <Panel defaultSize={50} minSize={20}>
          <section className={styles.panelContent} aria-label="Right panel" />
        </Panel>
      </Group>
    </main>
  );
}

export default App;
