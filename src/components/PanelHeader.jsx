import PanelTypeSwitcher from "./PanelTypeSwitcher";
import styles from "./PanelHeader.module.scss";

function PanelHeader({ panelType, onPanelTypeChange, children }) {
  return (
    <header className={styles.header}>
      <PanelTypeSwitcher
        panelType={panelType}
        onPanelTypeChange={onPanelTypeChange}
      />
      {children ? <div className={styles.content}>{children}</div> : null}
    </header>
  );
}

export default PanelHeader;
