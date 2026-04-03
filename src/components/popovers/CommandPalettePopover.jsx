import { useEffect, useRef, useState } from "react";
import FloatingPopover from "./FloatingPopover";
import styles from "./CommandPalettePopover.module.scss";

function CommandPalettePopover({
  open = false,
  position = { x: 8, y: 8 },
  commands = [],
  onClose = undefined,
}) {
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  return <FloatingPopover
    open={open}
    position={position}
    onClose={onClose}
    className={styles.palette}
  >
    <label className={styles.searchLabel}>
      <span className={styles.searchTitle}>Command Palette</span>
      <input
        ref={inputRef}
        className={styles.searchInput}
        type="text"
        value={query}
        placeholder="Type a command"
        onChange={event => setQuery(event.target.value)}
        onBlur={() => onClose?.()}
      />
    </label>
    <ul className={styles.commandList}>
      {commands.map(command => <li key={command.id} className={styles.commandRow}>
        <span className={styles.commandName}>{command.title}</span>
        <span className={styles.commandShortcut}>{command.shortcut || ""}</span>
      </li>)}
    </ul>
  </FloatingPopover>;
}

export default CommandPalettePopover;
