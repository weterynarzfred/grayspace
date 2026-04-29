import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import FloatingPopover from "./FloatingPopover";
import styles from "./ContextMenuPopover.module.scss";

const VIEWPORT_PADDING = 8;

function clampSubmenuPosition(x, y, width, height) {
  const maxX = window.innerWidth - width - VIEWPORT_PADDING;
  const maxY = window.innerHeight - height - VIEWPORT_PADDING;
  return {
    x: Math.min(Math.max(x, VIEWPORT_PADDING), maxX),
    y: Math.min(Math.max(y, VIEWPORT_PADDING), maxY),
  };
}

function ContextMenuPopover({
  open = false,
  position = { x: 8, y: 8 },
  target = null,
  commands = [],
  onCommand = undefined,
  onClose = undefined,
}) {
  const rootRef = useRef(null);
  const submenuRef = useRef(null);
  const listItemRefs = useRef(new Map());
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [submenuOpenIndex, setSubmenuOpenIndex] = useState(-1);
  const [selectedSubmenuIndex, setSelectedSubmenuIndex] = useState(-1);
  const [submenuPosition, setSubmenuPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(commands.length > 0 ? 0 : -1);
    setSubmenuOpenIndex(-1);
    setSelectedSubmenuIndex(-1);
    requestAnimationFrame(() => rootRef.current?.focus());
  }, [commands.length, open]);

  useLayoutEffect(() => {
    if (submenuOpenIndex < 0) return;
    const li = listItemRefs.current.get(submenuOpenIndex);
    if (!li || !submenuRef.current) return;
    const triggerRect = li.getBoundingClientRect();
    const subRect = submenuRef.current.getBoundingClientRect();
    const clamped = clampSubmenuPosition(
      triggerRect.right,
      triggerRect.top,
      subRect.width,
      subRect.height,
    );
    setSubmenuPosition(clamped);
  }, [submenuOpenIndex]);

  if (!target) return null;

  const title = `${target.kind[0]?.toUpperCase() || ""}${target.kind.slice(1)} target`;

  const isInSubmenu = submenuOpenIndex >= 0 && selectedSubmenuIndex >= 0;
  const activeSubmenu = submenuOpenIndex >= 0 ? (commands[submenuOpenIndex]?.submenu ?? []) : [];

  const openSubmenu = (index) => {
    setSubmenuOpenIndex(index);
    setSelectedSubmenuIndex(0);
  };

  const closeSubmenu = () => {
    setSubmenuOpenIndex(-1);
    setSelectedSubmenuIndex(-1);
  };

  const handleKeyDown = (event) => {
    if (isInSubmenu) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedSubmenuIndex(i => (i + 1) % activeSubmenu.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedSubmenuIndex(i => (i - 1 + activeSubmenu.length) % activeSubmenu.length);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "Escape") {
        event.preventDefault();
        closeSubmenu();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const cmd = activeSubmenu[selectedSubmenuIndex];
        if (cmd) onCommand?.(cmd.id);
        return;
      }
      return;
    }

    if (commands.length === 0) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex(i => i < 0 ? 0 : (i + 1) % commands.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex(i => i < 0 ? commands.length - 1 : (i - 1 + commands.length) % commands.length);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const cmd = commands[Math.max(0, selectedIndex)];
      if (cmd?.submenu?.length > 0) openSubmenu(selectedIndex);
      return;
    }
    if (event.key === "Escape" && submenuOpenIndex >= 0) {
      event.preventDefault();
      closeSubmenu();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const selectedCommand = commands[Math.max(0, selectedIndex)];
    if (!selectedCommand) return;
    if (selectedCommand.submenu?.length > 0) {
      openSubmenu(selectedIndex);
    } else {
      onCommand?.(selectedCommand.id);
    }
  };

  const submenuPortal = submenuOpenIndex >= 0
    ? createPortal(
      <ul
        ref={submenuRef}
        className={styles.submenu}
        style={{ left: `${submenuPosition.x}px`, top: `${submenuPosition.y}px` }}
        onMouseLeave={() => setSelectedSubmenuIndex(-1)}
      >
        {activeSubmenu.map((subCmd, subIndex) => <li key={subCmd.id}>
          <button
            type="button"
            className={`${styles.commandRow} ${selectedSubmenuIndex === subIndex ? styles.commandRowSelected : ""}`.trim()}
            onMouseEnter={() => setSelectedSubmenuIndex(subIndex)}
            onClick={() => onCommand?.(subCmd.id)}
          >
            <span className={styles.commandName}>{subCmd.title}</span>
            <span className={styles.commandShortcut}>{subCmd.shortcut || ""}</span>
          </button>
        </li>)}
      </ul>,
      document.body,
    )
    : null;

  return <>
    <FloatingPopover
      open={open}
      position={position}
      onClose={onClose}
      className={styles.menu}
      extraRefs={[submenuRef]}
    >
      <div
        ref={rootRef}
        role="dialog"
        aria-label={title}
        data-testid="context-menu-root"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <ul className={styles.commandList}>
          {commands.map((command, index) => {
            const isSelected = selectedIndex === index;
            const hasSubmenu = Array.isArray(command.submenu) && command.submenu.length > 0;
            const isSubmenuOpen = submenuOpenIndex === index;

            return <li
              key={command.id}
              ref={el => { if (el) listItemRefs.current.set(index, el); else listItemRefs.current.delete(index); }}
              onMouseEnter={() => {
                setSelectedIndex(index);
                if (hasSubmenu) {
                  setSubmenuOpenIndex(index);
                  setSelectedSubmenuIndex(-1);
                } else {
                  closeSubmenu();
                }
              }}
            >
              <button
                type="button"
                className={`${styles.commandRow} ${isSelected && !isSubmenuOpen ? styles.commandRowSelected : ""} ${isSubmenuOpen ? styles.commandRowSubmenuOpen : ""}`.trim()}
                onClick={() => {
                  if (hasSubmenu) {
                    setSubmenuOpenIndex(isSubmenuOpen ? -1 : index);
                    setSelectedSubmenuIndex(isSubmenuOpen ? -1 : 0);
                  } else {
                    onCommand?.(command.id);
                  }
                }}
              >
                <span className={styles.commandName}>{command.title}</span>
                {hasSubmenu
                  ? <span className={styles.commandSubmenuArrow}>▶</span>
                  : <span className={styles.commandShortcut}>{command.shortcut || ""}</span>
                }
              </button>
            </li>;
          })}
          {commands.length === 0 ? <li className={styles.emptyRow}>No actions available</li> : null}
        </ul>
      </div>
    </FloatingPopover>
    {submenuPortal}
  </>;
}

export default ContextMenuPopover;
