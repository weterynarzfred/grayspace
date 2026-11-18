import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import FloatingPopover from "../popovers/FloatingPopover";
import {
  areSearchOptionsEqual,
  DEFAULT_SEARCH_OPTIONS,
  parseFolderNames,
} from "./filesystemSearchOptions";
import styles from "./FilesystemPanel.module.scss";

const REGEX_TOGGLE_TITLE = "Regex on the path relative to this folder, / between folders";

// The ".*" toggle and the options panel next to the search box. The skip list is edited as
// comma-separated text and parsed only on blur or Enter, so typing "a, " is not reformatted mid-word.
// The panel is portaled to the body so it paints above neighbouring panes; it carries
// data-search-options so the search box and the pane's key handling still treat it as theirs.
export default function FilesystemSearchControls({ options, anchorRef, onChange }) {
  const optionsButtonRef = useRef(null);
  const panelRef = useRef(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ x: 8, y: 8 });
  const [skipNamesDraft, setSkipNamesDraft] = useState(null);

  // Runs on Escape, a click outside or the options button. Focus leaves the panel before it
  // unmounts, so the names input still commits on blur and a later click elsewhere still closes an
  // empty search box. The panel can already be gone when Escape in the search box closed it all.
  const closePanel = () => {
    if (panelRef.current?.contains(document.activeElement)) optionsButtonRef.current.focus();
    setIsPanelOpen(false);
  };

  const togglePanel = () => {
    if (isPanelOpen) {
      closePanel();
      return;
    }
    const anchorBounds = anchorRef.current.getBoundingClientRect();
    setPanelPosition({ x: anchorBounds.left, y: anchorBounds.bottom + 2 });
    setIsPanelOpen(true);
  };

  const commitSkipNames = () => {
    if (skipNamesDraft === null) return;
    onChange({ skipFolderNames: parseFolderNames(skipNamesDraft) });
    setSkipNamesDraft(null);
  };

  return <>
    <button
      type="button"
      className={styles.queryOptionButton}
      aria-label="Use regular expression"
      aria-pressed={options.useRegex}
      title={REGEX_TOGGLE_TITLE}
      // Keeps the caret in the search box.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onChange({ useRegex: !options.useRegex })}
    >.*</button>
    <button
      ref={optionsButtonRef}
      type="button"
      className={styles.queryOptionButton}
      aria-label="Search options"
      aria-expanded={isPanelOpen}
      title="Search options"
      onClick={togglePanel}
    >▾</button>
    {createPortal(<FloatingPopover
      open={isPanelOpen}
      position={panelPosition}
      onClose={closePanel}
      extraRefs={[optionsButtonRef]}
    >
      {/* Focusable, so clicking its text keeps focus inside the search box. */}
      <div
        ref={panelRef}
        className={styles.searchOptionsPanel}
        role="group"
        aria-label="Search options"
        tabIndex={-1}
        data-search-options
      >
        <label className={styles.searchOptionsRow}>
          <input
            type="checkbox"
            checked={options.skipFolders}
            onChange={(event) => onChange({ skipFolders: event.target.checked })}
          />
          Skip folders
        </label>
        <input
          type="text"
          className={styles.searchOptionsNames}
          aria-label="Folder names to skip, comma-separated"
          spellCheck={false}
          value={skipNamesDraft ?? options.skipFolderNames.join(", ")}
          onChange={(event) => setSkipNamesDraft(event.target.value)}
          onBlur={commitSkipNames}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitSkipNames();
          }}
        />
        <label className={styles.searchOptionsRow}>
          <input
            type="checkbox"
            checked={options.skipCacheDirTagged}
            onChange={(event) => onChange({ skipCacheDirTagged: event.target.checked })}
          />
          Skip folders containing a CACHEDIR.TAG file (e.g. Rust target/)
        </label>
        <button
          type="button"
          className={styles.searchOptionsReset}
          disabled={areSearchOptionsEqual(options, DEFAULT_SEARCH_OPTIONS)}
          onClick={() => {
            // The button disables itself; a disabled focused button drops focus to the body,
            // which would close an empty search box.
            panelRef.current.focus();
            onChange(DEFAULT_SEARCH_OPTIONS);
          }}
        >Reset to defaults</button>
      </div>
    </FloatingPopover>, document.body)}
  </>;
}
