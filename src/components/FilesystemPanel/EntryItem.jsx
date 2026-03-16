import styles from "./EntryItem.module.scss";

function EntryItem({
  label,
  meta,
  isSelected = false,
  isFile = false,
  onClick,
  onDoubleClick,
}) {
  return (
    <li className={styles.entryItem}>
      <button
        type="button"
        className={`${styles.entryButton} ${isSelected ? styles.selected : ""} ${
          isFile ? styles.file : ""
        }`}
        aria-selected={isSelected}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        <span className={styles.entryName}>{label}</span>
        <span className={styles.entryPath}>{meta}</span>
      </button>
    </li>
  );
}

export default EntryItem;
