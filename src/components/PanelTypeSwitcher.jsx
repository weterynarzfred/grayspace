import { useEffect, useMemo, useRef, useState } from "react";
import placeholderIcon from "../media/icon/placeholder.svg";
import FloatingPopover from "./popovers/FloatingPopover";
import { PANEL_TYPES } from "./panelTypes";
import styles from "./PanelTypeSwitcher.module.scss";

export default function PanelTypeSwitcher({
  panelType,
  panelLabel = "",
  onPanelTypeChange,
}) {
  const triggerRef = useRef(null);
  const rowListRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ x: 8, y: 8 });
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const selectedType = useMemo(() => (
    PANEL_TYPES.find((type) => type.value === panelType) ?? PANEL_TYPES[0]
  ), [panelType]);
  const resolvedLabel = useMemo(() => {
    const explicitLabel = typeof panelLabel === "string" ? panelLabel.trim() : "";
    if (explicitLabel) return explicitLabel;
    return selectedType?.label || panelType || "Panel";
  }, [panelLabel, panelType, selectedType?.label]);

  useEffect(() => {
    if (!isOpen) return;
    const nextIndex = PANEL_TYPES.findIndex((type) => type.value === panelType);
    setSelectedIndex(nextIndex >= 0 ? nextIndex : 0);
  }, [isOpen, panelType]);

  useEffect(() => {
    if (!isOpen) return;
    if (selectedIndex < 0 || selectedIndex >= PANEL_TYPES.length) return;
    const selectedRow = rowListRef.current?.querySelector(`[data-panel-type-index="${selectedIndex}"]`);
    selectedRow?.scrollIntoView?.({ block: "nearest" });
  }, [isOpen, selectedIndex]);

  const openPopover = (index = -1) => {
    const triggerBounds = triggerRef.current?.getBoundingClientRect?.();
    if (triggerBounds) {
      setPopoverPosition({
        x: triggerBounds.left,
        y: triggerBounds.bottom + 2,
      });
    }

    const nextIndex = index >= 0
      ? Math.min(index, Math.max(0, PANEL_TYPES.length - 1))
      : PANEL_TYPES.findIndex((type) => type.value === panelType);
    setSelectedIndex(nextIndex >= 0 ? nextIndex : 0);
    setIsOpen(true);
  };

  const closePopover = () => {
    setIsOpen(false);
  };

  const applyPanelType = (nextPanelType) => {
    if (typeof nextPanelType !== "string" || !nextPanelType) return;
    onPanelTypeChange?.(nextPanelType);
    closePopover();
  };

  const handleTriggerKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openPopover(Math.max(0, selectedIndex));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      openPopover(PANEL_TYPES.length - 1);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (isOpen) closePopover();
    else openPopover();
  };

  const handlePopoverKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePopover();
      triggerRef.current?.focus();
      return;
    }

    if (PANEL_TYPES.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) => (current + 1 + PANEL_TYPES.length) % PANEL_TYPES.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) => (current - 1 + PANEL_TYPES.length) % PANEL_TYPES.length);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const selectedTypeEntry = PANEL_TYPES[Math.max(0, selectedIndex)];
    if (selectedTypeEntry) applyPanelType(selectedTypeEntry.value);
  };

  return <>
    <button
      ref={triggerRef}
      type="button"
      className={styles.trigger}
      aria-label="Panel type switcher"
      aria-expanded={isOpen}
      onClick={() => {
        if (isOpen) closePopover();
        else openPopover();
      }}
      onKeyDown={handleTriggerKeyDown}
    >
      <img src={placeholderIcon} alt="" className={styles.triggerIcon} draggable={false} />
      <span className={styles.triggerLabel}>{resolvedLabel}</span>
      <span className={styles.triggerChevron} aria-hidden>▾</span>
    </button>
    <FloatingPopover
      open={isOpen}
      position={popoverPosition}
      onClose={closePopover}
      className={styles.popover}
    >
      <div
        className={styles.menu}
        onKeyDown={handlePopoverKeyDown}
      >
        <p className={styles.menuTitle}>Panel Type</p>
        <ul ref={rowListRef} className={styles.rowList}>
          {PANEL_TYPES.map((type, index) => <li key={type.value} className={styles.rowItem}>
            <button
              type="button"
              data-panel-type-index={index}
              className={`${styles.rowButton} ${selectedIndex === index ? styles.rowButtonSelected : ""}`.trim()}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => applyPanelType(type.value)}
            >
              <img src={placeholderIcon} alt="" className={styles.rowIcon} draggable={false} />
              <span className={styles.rowLabel}>{type.label}</span>
            </button>
          </li>)}
        </ul>
      </div>
    </FloatingPopover>
  </>;
}
