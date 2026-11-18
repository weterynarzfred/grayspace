import { useEffect, useRef } from "react";
import FilesystemSearchControls from "./FilesystemSearchControls";
import styles from "./FilesystemPanel.module.scss";

const MODE_LABELS = {
  filter: { placeholder: "Filter", ariaLabel: "Filter current folder" },
  search: { placeholder: "Search subfolders", ariaLabel: "Search current folder and subfolders" },
};

// One box for both Ctrl+F (filter this folder) and Ctrl+Shift+F (search subfolders); either
// shortcut inside the box switches mode and keeps the text. Escape clears and closes;
// Enter / Arrow Down keep the query and hand the keyboard back to the list. An empty box closes
// when focus leaves it, but not when focus moves to the search options next to it.
export default function FilesystemQueryInput({
  mode,
  value,
  focusRequestKey,
  searchOptions,
  onChange,
  onSearchOptionsChange,
  onModeChange,
  onClose,
  onSubmit,
}) {
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const { ariaLabel } = MODE_LABELS[mode];
  const placeholder = mode === "search" && searchOptions.useRegex
    ? "Regex on relative path"
    : MODE_LABELS[mode].placeholder;

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

  return <div
    ref={containerRef}
    className={styles.queryBox}
    onBlur={(event) => {
      if (value || event.currentTarget.contains(event.relatedTarget)) return;
      // The options panel is portaled, so it is not inside this container in the DOM.
      if (event.relatedTarget?.closest("[data-search-options]")) return;
      onClose();
    }}
  >
    <input
      ref={inputRef}
      type="search"
      className={`${styles.filterInput} ${mode === "search" ? styles.searchInput : ""}`}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
    />
    {mode === "search" && <FilesystemSearchControls
      options={searchOptions}
      anchorRef={containerRef}
      onChange={onSearchOptionsChange}
    />}
  </div>;
}
