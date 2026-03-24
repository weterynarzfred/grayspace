import PanelTypeSwitcher from "./PanelTypeSwitcher";
import { usePaneHeaderActions } from "./paneHeaderActionsContext";
import styles from "./PanelHeader.module.scss";

function PanelHeader({ panelType, onPanelTypeChange, children }) {
  const paneActions = usePaneHeaderActions();

  return (
    <header className={styles.header}>
      <PanelTypeSwitcher
        panelType={panelType}
        onPanelTypeChange={onPanelTypeChange}
      />
      {children ? <div className={styles.content}>{children}</div> : null}
      {paneActions ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={paneActions.onSplitRight}
            title="Split pane right (Alt+V)"
          >
            Split Right
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={paneActions.onSplitDown}
            title="Split pane down (Alt+H)"
          >
            Split Down
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={paneActions.onClose}
            disabled={!paneActions.canClose}
            title={paneActions.canClose ? "Close pane" : "Cannot close the last pane"}
          >
            Close Pane
          </button>
        </div>
      ) : null}
    </header>
  );
}

export default PanelHeader;
