import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import styles from "./TerminalPanel.module.scss";
import useTerminalSession from "./hooks/useTerminalSession";
import "@xterm/xterm/css/xterm.css";

function TerminalPanel({
  panelType = "Terminal",
  onPanelTypeChange = undefined,
  cwdHint = "",
  terminalSessionId = "",
}) {
  const { terminalHostRef, status } = useTerminalSession(cwdHint, terminalSessionId);

  return <section
    className={`${shellStyles.panelContent} ${styles.panelContent}`}
    aria-label="Terminal panel"
  >
    <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange}>
      <span className={styles.cwdLabel} title={cwdHint || "No folder selected"}>
        {cwdHint || "No folder selected"}
      </span>
    </PanelHeader>
    <div className={styles.panelBody}>
      {status ? <p className={styles.status}>{status}</p> : null}
      <div className={styles.terminalFrame}>
        <div ref={terminalHostRef} className={styles.terminalHost} />
      </div>
    </div>
  </section>;
}

export default TerminalPanel;
