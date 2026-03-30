import PanelTypeSwitcher from "./PanelTypeSwitcher";
import { usePaneHeaderActions } from "./paneHeaderActionsContext";
import styles from "./PanelHeader.module.scss";

function PanelHeader({ panelType, onPanelTypeChange, children }) {
  const paneActions = usePaneHeaderActions();
  const headerClassName = paneActions?.isActive
    ? `${styles.header} ${styles.headerActive}`
    : styles.header;

  return <header className={headerClassName}>
    <PanelTypeSwitcher panelType={panelType} onPanelTypeChange={onPanelTypeChange} />
    {children ? <div className={styles.content}>{children}</div> : null}
    {paneActions?.canClose ? <div className={styles.actions}>
      <button
        type="button"
        className={styles.actionButton}
        onClick={paneActions.onClose}
        title="Close Pane"
      >&times;</button>
    </div> : null}
  </header>;
}

export default PanelHeader;
