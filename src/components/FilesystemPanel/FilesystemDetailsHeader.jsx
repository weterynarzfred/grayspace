import { DETAILS_COLUMNS } from "./filesystemEntryDetails";
import styles from "./FilesystemDetailsHeader.module.scss";

export default function FilesystemDetailsHeader({ sortKey, sortDescending, onSort }) {
  const renderColumn = ({ key, label }) => {
    const isActive = key === sortKey;
    return <button
      key={key}
      type="button"
      className={`${styles.column} ${key === "size" ? styles.alignEnd : ""} ${isActive ? styles.active : ""}`}
      title={`Sort by ${label.toLowerCase()}`}
      onClick={(event) => {
        event.preventDefault();
        onSort(key);
      }}
    >
      {label}
      {isActive && <span className={styles.direction} aria-label={sortDescending ? "descending" : "ascending"}>
        {sortDescending ? "▾" : "▴"}
      </span>}
    </button>;
  };

  return <div className={styles.header} data-testid="filesystem-details-header">
    <span className={styles.nameColumn}>{renderColumn({ key: "name", label: "Name" })}</span>
    <span className={styles.detailColumns}>{DETAILS_COLUMNS.map(renderColumn)}</span>
  </div>;
}
