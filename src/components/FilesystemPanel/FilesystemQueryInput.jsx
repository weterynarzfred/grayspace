import { useEffect, useRef } from "react";
import styles from "./FilesystemPanel.module.scss";

const MODE_LABELS = {
  filter: { placeholder: "Filter", ariaLabel: "Filter current folder" },
  search: { placeholder: "Search subfolders", ariaLabel: "Search current folder and subfolders" },
};

// One box for both Ctrl+F (filter this folder) and Ctrl+Shift+F (search subfolders); either
// shortcut inside the box switches mode and keeps the text. Escape clears and closes;
// Enter / Arrow Down keep the query and hand the keyboard back to the list.
export default function FilesystemQueryInput({
  mode,
  value,
  focusRequestKey,
  onChange,
  onModeChange,
  onClose,
  onSubmit,
}) {
  const inputRef = useRef(null);
  const { placeholder, ariaLabel } = MODE_LABELS[mode];

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequestKey]);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onChange("");
      onClose();
      return;
    }
    if (event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      event.currentTarget.blur();
      onSubmit();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      onModeChange(event.shiftKey ? "search" : "filter");
    }
  }

  return <input
    ref={inputRef}
    type="search"
    className={`${styles.filterInput} ${mode === "search" ? styles.searchInput : ""}`}
    value={value}
    placeholder={placeholder}
    aria-label={ariaLabel}
    spellCheck={false}
    onChange={(event) => onChange(event.target.value)}
    onKeyDown={handleKeyDown}
    onBlur={() => {
      if (!value) onClose();
    }}
  />;
}
