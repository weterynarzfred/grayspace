import { useEffect, useRef, useState } from "react";
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
  const rootRef = useRef(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(commands.length > 0 ? 0 : -1);
    requestAnimationFrame(() => rootRef.current?.focus());
  }, [commands.length, open]);

  if (!target) return null;

  const title = `${target.kind[0]?.toUpperCase() || ""}${target.kind.slice(1)} target`;

  const handleKeyDown = (event) => {
    if (commands.length === 0) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) => (
        current < 0 ? 0 : (current + 1) % commands.length
      ));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) => (
        current < 0 ? commands.length - 1 : (current - 1 + commands.length) % commands.length
      ));
      return;
    }

    if (event.key !== "Enter") return;
    event.preventDefault();
    const selectedCommand = commands[selectedIndex >= 0 ? selectedIndex : 0];
    if (selectedCommand) onCommand?.(selectedCommand.id);
  };

  return <FloatingPopover
    open={open}
    position={position}
    onClose={onClose}
    className={styles.menu}
  >
    <div
      ref={rootRef}
      role="dialog"
      aria-label={title}
      data-testid="context-menu-root"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
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
        {commands.map((command, index) => <li key={command.id}>
          <button
            type="button"
            className={`${styles.commandRow} ${selectedIndex === index ? styles.commandRowSelected : ""}`.trim()}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => onCommand?.(command.id)}
          >
            <span className={styles.commandName}>{command.title}</span>
            <span className={styles.commandShortcut}>{command.shortcut || ""}</span>
          </button>
        </li>)}
        {commands.length === 0 ? <li className={styles.emptyRow}>No actions available</li> : null}
      </ul>
    </div>
  </FloatingPopover>;
}

export default ContextMenuPopover;
