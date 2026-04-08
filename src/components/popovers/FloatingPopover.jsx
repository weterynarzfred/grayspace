import { useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./FloatingPopover.module.scss";

const VIEWPORT_PADDING = 8;

function clampPosition(position, size) {
  const nextX = Number.isFinite(position?.x) ? position.x : VIEWPORT_PADDING;
  const nextY = Number.isFinite(position?.y) ? position.y : VIEWPORT_PADDING;
  const maxX = Math.max(VIEWPORT_PADDING, window.innerWidth - size.width - VIEWPORT_PADDING);
  const maxY = Math.max(VIEWPORT_PADDING, window.innerHeight - size.height - VIEWPORT_PADDING);
  return {
    x: Math.min(Math.max(nextX, VIEWPORT_PADDING), maxX),
    y: Math.min(Math.max(nextY, VIEWPORT_PADDING), maxY),
  };
}

function arePositionsEqual(a, b) {
  return a?.x === b?.x && a?.y === b?.y;
}

function FloatingPopover({
  open = false,
  position = { x: VIEWPORT_PADDING, y: VIEWPORT_PADDING },
  className = "",
  onClose = undefined,
  children,
}) {
  const popoverRef = useRef(null);
  const [resolvedPosition, setResolvedPosition] = useState(position);

  useLayoutEffect(() => {
    if (!open || !popoverRef.current) return;
    const rect = popoverRef.current.getBoundingClientRect();
    setResolvedPosition((previousPosition) => {
      const nextPosition = clampPosition(position, rect);
      if (arePositionsEqual(previousPosition, nextPosition)) return previousPosition;
      return nextPosition;
    });
  }, [open, position]);

  useEffect(() => {
    if (!open || !popoverRef.current) return undefined;

    const updateResolvedPosition = () => {
      const popover = popoverRef.current;
      if (!popover) return;
      const rect = popover.getBoundingClientRect();
      setResolvedPosition((previousPosition) => {
        const nextPosition = clampPosition(previousPosition, rect);
        if (arePositionsEqual(previousPosition, nextPosition)) return previousPosition;
        return nextPosition;
      });
    };

    window.addEventListener("resize", updateResolvedPosition);

    const canObserveResize = typeof window.ResizeObserver === "function";
    const resizeObserver = canObserveResize
      ? new window.ResizeObserver(updateResolvedPosition)
      : null;
    resizeObserver?.observe(popoverRef.current);

    return () => {
      window.removeEventListener("resize", updateResolvedPosition);
      resizeObserver?.disconnect();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (popoverRef.current?.contains(event.target)) return;
      onClose?.();
    };
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose?.();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return <div
    ref={popoverRef}
    className={`${styles.popover} ${className}`.trim()}
    style={{
      left: `${resolvedPosition.x}px`,
      top: `${resolvedPosition.y}px`,
    }}
    onContextMenu={event => event.preventDefault()}
  >
    {children}
  </div>;
}

export default FloatingPopover;
