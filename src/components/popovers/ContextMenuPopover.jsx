import FloatingPopover from "./FloatingPopover";
import styles from "./ContextMenuPopover.module.scss";

function ContextMenuPopover({
  open = false,
  position = { x: 8, y: 8 },
  target = null,
  commands = [],
  onCommand = undefined,
  onClose = undefined,
}) {
  if (!target) return null;

  const title = `${target.kind[0]?.toUpperCase() || ""}${target.kind.slice(1)} target`;

  return <FloatingPopover
    open={open}
    position={position}
    onClose={onClose}
    className={styles.menu}
  >
    <h2 className={styles.title}>Context Menu</h2>
    <p className={styles.row}>
      <span className={styles.label}>Type</span>
      <span>{title}</span>
    </p>
    <p className={styles.row}>
      <span className={styles.label}>Name</span>
      <span>{target.label || "N/A"}</span>
    </p>
    <p className={styles.row}>
      <span className={styles.label}>ID</span>
      <span>{target.id || "N/A"}</span>
    </p>
    <p className={styles.row}>
      <span className={styles.label}>Path</span>
      <span className={styles.path}>{target.path || "N/A"}</span>
    </p>
    <ul className={styles.commandList}>
      {commands.map(command => <li key={command.id}>
        <button
          type="button"
          className={styles.commandRow}
          onClick={() => onCommand?.(command.id)}
        >
          <span className={styles.commandName}>{command.title}</span>
          <span className={styles.commandShortcut}>{command.shortcut || ""}</span>
        </button>
      </li>)}
      {commands.length === 0 ? <li className={styles.emptyRow}>No actions available</li> : null}
    </ul>
  </FloatingPopover>;
}

export default ContextMenuPopover;
