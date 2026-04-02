import FloatingPopover from "./FloatingPopover";
import styles from "./ContextMenuPopover.module.scss";

function ContextMenuPopover({
  open = false,
  position = { x: 8, y: 8 },
  target = null,
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
  </FloatingPopover>;
}

export default ContextMenuPopover;
