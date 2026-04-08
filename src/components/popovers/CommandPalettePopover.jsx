import { useEffect, useRef, useState } from "react";
import FloatingPopover from "./FloatingPopover";
import styles from "./CommandPalettePopover.module.scss";

function CommandPalettePopover({
  open = false,
  position = { x: 8, y: 8 },
  commands = [],
  onCommand = undefined,
  onClose = undefined,
}) {
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(-1);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(commands.length > 0 ? 0 : -1);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [commands.length, open]);

  const handleInputKeyDown = (event) => {
    if (commands.length === 0) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) =>
        current < 0 ? 0 : (current + 1) % commands.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) =>
        current < 0 ? commands.length - 1 : (current - 1 + commands.length) % commands.length);
      return;
    }

    if (event.key !== "Enter") return;
    event.preventDefault();
    const command = commands[Math.max(0, selectedIndex)];
    if (command) onCommand?.(command.id);
  };

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
        onKeyDown={handleInputKeyDown}
        onBlur={() => onClose?.()}
      />
    </label>
    <ul className={styles.commandList}>
      {commands.map((command, index) => <li key={command.id} className={styles.commandItem}>
        <button
          type="button"
          className={`${styles.commandRow} ${selectedIndex === index ? styles.commandRowSelected : ""}`.trim()}
          onMouseDown={event => event.preventDefault()}
          onMouseEnter={() => setSelectedIndex(index)}
          onClick={() => onCommand?.(command.id)}
        >
          <span className={styles.commandName}>{command.title}</span>
          <span className={styles.commandShortcut}>{command.shortcut || ""}</span>
        </button>
      </li>)}
      {commands.length === 0 ? <li className={styles.emptyRow}>No commands available</li> : null}
    </ul>
  </FloatingPopover>;
}

export default CommandPalettePopover;
