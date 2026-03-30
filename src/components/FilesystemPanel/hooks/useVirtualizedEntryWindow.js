import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_OVERSCAN_ROWS = 10;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

function getOffsetTopWithinContainer(container, element) {
  let offsetTop = 0;
  let currentElement = element;

  while (currentElement && currentElement !== container) {
    offsetTop += currentElement.offsetTop;
    currentElement = currentElement.offsetParent;
  }

  return offsetTop;
}

function getFullWindowState(itemCount) {
  return {
    startIndex: 0,
    endIndex: itemCount,
    topSpacerHeight: 0,
    bottomSpacerHeight: 0,
  };
}

export default function useVirtualizedEntryWindow({
  itemCount = 0,
  rowHeightPx = 29,
  overscanRows = DEFAULT_OVERSCAN_ROWS,
  isEnabled = false,
  scrollContainerRef = undefined,
  listStartAnchorRef = undefined,
}) {
  const [windowState, setWindowState] = useState(getFullWindowState(itemCount));
  const frameRef = useRef(null);

  const setStateIfChanged = useCallback((nextState) => {
    setWindowState((previousState) => {
      if (
        previousState.startIndex === nextState.startIndex
        && previousState.endIndex === nextState.endIndex
        && previousState.topSpacerHeight === nextState.topSpacerHeight
        && previousState.bottomSpacerHeight === nextState.bottomSpacerHeight
      ) {
        return previousState;
      }

      return nextState;
    });
  }, []);

  const recomputeWindow = useCallback(() => {
    if (!isEnabled || itemCount <= 0) {
      setStateIfChanged(getFullWindowState(itemCount));
      return;
    }

    const scrollContainer = scrollContainerRef?.current;
    const listStartAnchor = listStartAnchorRef?.current;
    if (!scrollContainer || !listStartAnchor) {
      setStateIfChanged(getFullWindowState(itemCount));
      return;
    }

    const scrollTop = Math.max(0, scrollContainer.scrollTop);
    const viewportHeight = Math.max(rowHeightPx, scrollContainer.clientHeight);
    const startOffset = getOffsetTopWithinContainer(scrollContainer, listStartAnchor);
    const relativeScrollTop = Math.max(0, scrollTop - startOffset);
    const firstVisibleIndex = Math.floor(relativeScrollTop / rowHeightPx);
    const visibleItemCount = Math.ceil(viewportHeight / rowHeightPx);
    const startIndex = clamp(firstVisibleIndex - overscanRows, 0, itemCount);
    const endIndex = clamp(
      firstVisibleIndex + visibleItemCount + overscanRows,
      startIndex,
      itemCount,
    );

    setStateIfChanged({
      startIndex,
      endIndex,
      topSpacerHeight: startIndex * rowHeightPx,
      bottomSpacerHeight: (itemCount - endIndex) * rowHeightPx,
    });
  }, [
    isEnabled,
    itemCount,
    overscanRows,
    rowHeightPx,
    scrollContainerRef,
    listStartAnchorRef,
    setStateIfChanged,
  ]);

  const scheduleRecompute = useCallback(() => {
    if (typeof window === "undefined") {
      recomputeWindow();
      return;
    }

    if (frameRef.current !== null) return;

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      recomputeWindow();
    });
  }, [recomputeWindow]);

  useEffect(() => {
    recomputeWindow();
  }, [recomputeWindow, itemCount, isEnabled]);

  useEffect(() => {
    if (!isEnabled) return undefined;

    const onWindowResize = () => {
      scheduleRecompute();
    };

    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
    };
  }, [isEnabled, scheduleRecompute]);

  useEffect(() => {
    if (!isEnabled || typeof ResizeObserver === "undefined") return undefined;
    const scrollContainer = scrollContainerRef?.current;
    const listStartAnchor = listStartAnchorRef?.current;
    if (!scrollContainer || !listStartAnchor) return undefined;

    const observer = new ResizeObserver(() => {
      scheduleRecompute();
    });
    observer.observe(scrollContainer);
    observer.observe(listStartAnchor);
    return () => {
      observer.disconnect();
    };
  }, [isEnabled, scheduleRecompute, scrollContainerRef, listStartAnchorRef, itemCount]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return useMemo(() => ({
    ...windowState,
    scheduleRecompute,
  }), [scheduleRecompute, windowState]);
}
