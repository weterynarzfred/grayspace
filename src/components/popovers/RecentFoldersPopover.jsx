import { useEffect, useMemo, useRef, useState } from "react";
import FloatingPopover from "./FloatingPopover";
import {
  formatRecentFolderOpenedAtLabel,
  normalizeRecentFolderEntries,
} from "./recentFoldersShared";
import styles from "./RecentFoldersPopover.module.scss";

function RecentFoldersPopover({
  open = false,
  position = { x: 8, y: 8 },
  entries = [],
  isLoading = false,
  onSelect = undefined,
  onClose = undefined,
}) {
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const normalizedEntries = useMemo(() => normalizeRecentFolderEntries(entries), [entries]);
  const visibleEntries = normalizedEntries;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(visibleEntries.length > 0 ? 0 : -1);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, visibleEntries.length]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex((current) => {
      if (visibleEntries.length === 0) return -1;
      if (current < 0) return 0;
      return Math.min(current, visibleEntries.length - 1);
    });
  }, [open, visibleEntries.length]);

  const handleInputKeyDown = (event) => {
    if (visibleEntries.length === 0) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) => (
        current < 0 ? 0 : (current + 1) % visibleEntries.length
      ));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) => (
        current < 0
          ? visibleEntries.length - 1
          : (current - 1 + visibleEntries.length) % visibleEntries.length
      ));
      return;
    }

    if (event.key !== "Enter") return;
    event.preventDefault();
    const selectedEntry = visibleEntries[Math.max(0, selectedIndex)];
    if (!selectedEntry?.path) return;
    onSelect?.(selectedEntry.path);
  };

  return <FloatingPopover
    open={open}
    position={position}
    onClose={onClose}
    className={styles.popover}
  >
    <label className={styles.searchLabel}>
      <span className={styles.searchTitle}>Recent folders</span>
      <input
        ref={inputRef}
        className={styles.searchInput}
        type="text"
        value={query}
        placeholder="Search folders (coming soon)"
        onChange={event => setQuery(event.target.value)}
        onKeyDown={handleInputKeyDown}
      />
    </label>
    <ul className={styles.entryList}>
      {visibleEntries.map((entry, index) => <li key={entry.path} className={styles.entryItem}>
        <button
          type="button"
          className={`${styles.entryRow} ${selectedIndex === index ? styles.entryRowSelected : ""}`.trim()}
          onMouseDown={event => event.preventDefault()}
          onMouseEnter={() => setSelectedIndex(index)}
          onClick={() => onSelect?.(entry.path)}
        >
          <span
            className={`${styles.entryPath} ${entry.isWorkspace ? styles.entryPathWorkspace : ""}`.trim()}
          >
            {entry.path}
          </span>
          <span className={styles.entryDate}>{formatRecentFolderOpenedAtLabel(entry.openedAtMs)}</span>
        </button>
      </li>)}
      {visibleEntries.length === 0 && !isLoading ? <li className={styles.emptyRow}>No recent folders.</li> : null}
      {isLoading ? <li className={styles.emptyRow}>Loading recent folders...</li> : null}
    </ul>
  </FloatingPopover>;
}

export default RecentFoldersPopover;
