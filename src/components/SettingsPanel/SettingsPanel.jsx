import PanelHeader from "../PanelHeader";
import { COMMANDS, formatCommandWhen } from "../../commands/commandRegistry";
import shellStyles from "../PanelShell.module.scss";
import styles from "./SettingsPanel.module.scss";

function SettingsPanel({ panelType = "Settings", onPanelTypeChange = undefined }) {
  return <section className={`${shellStyles.panelContent} ${styles.panelContent}`} aria-label="Settings panel">
    <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange}>
      <p className={styles.headerLabel}>Read-only command list</p>
    </PanelHeader>
    <div className={`${shellStyles.panelBody} ${styles.panelBody}`}>
      <h2 className={styles.sectionTitle}>Available commands</h2>
      <table className={styles.commandTable}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Shortcut</th>
            <th scope="col">When</th>
          </tr>
        </thead>
        <tbody>
          {COMMANDS.map(command => <tr key={command.id}>
            <td>
              <span className={styles.commandTitle}>{command.title}</span>
              <span className={styles.commandId}>{command.id}</span>
            </td>
            <td>{command.shortcut || "None"}</td>
            <td>{formatCommandWhen(command)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </section>;
}

export default SettingsPanel;
