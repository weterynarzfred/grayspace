import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_OVERSCAN_ROWS = 10;
const DEFAULT_MAX_VISIBLE_ROWS = 300;

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

// The row containing y: the last row whose top is at or above it.
function findRowIndexAt(rowOffsetsPx, y) {
  let low = 0;
  let high = rowOffsetsPx.length - 2;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (rowOffsetsPx[middle] <= y) low = middle;
    else high = middle - 1;
  }
  return low;
}

function getFullWindowState(itemCount) {
  return {
    startIndex: 0,
    endIndex: itemCount,
    topSpacerHeight: 0,
    bottomSpacerHeight: 0,
  };
}

// Rows of different heights pass rowOffsetsPx: every row's top, then the total height
// (itemCount + 1 values). Without it, every row is rowHeightPx tall.
export default function useVirtualizedEntryWindow({
  itemCount = 0,
  rowHeightPx = 29,
  rowOffsetsPx = undefined,
  overscanRows = DEFAULT_OVERSCAN_ROWS,
  maxVisibleRows = DEFAULT_MAX_VISIBLE_ROWS,
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
    if (!scrollContainer) {
      setStateIfChanged(getFullWindowState(itemCount));
      return;
    }
    const listStartAnchor = listStartAnchorRef?.current ?? null;

    const scrollTop = Math.max(0, scrollContainer.scrollTop);
    const viewportHeight = Math.max(rowHeightPx, scrollContainer.clientHeight);
    const startOffset = listStartAnchor
      ? getOffsetTopWithinContainer(scrollContainer, listStartAnchor)
      : 0;
    const relativeScrollTop = Math.max(0, scrollTop - startOffset);
    const getRowTop = (index) => (rowOffsetsPx ? rowOffsetsPx[index] : index * rowHeightPx);
    const firstVisibleIndex = rowOffsetsPx
      ? findRowIndexAt(rowOffsetsPx, relativeScrollTop)
      : Math.floor(relativeScrollTop / rowHeightPx);
    const fittingRowCount = rowOffsetsPx
      ? findRowIndexAt(rowOffsetsPx, relativeScrollTop + viewportHeight) - firstVisibleIndex + 1
      : Math.ceil(viewportHeight / rowHeightPx);
    const visibleItemCount = Math.min(fittingRowCount, Math.max(1, maxVisibleRows));
    const startIndex = clamp(firstVisibleIndex - overscanRows, 0, itemCount);
    const endIndex = clamp(
      firstVisibleIndex + visibleItemCount + overscanRows,
      startIndex,
      itemCount,
    );

    setStateIfChanged({
      startIndex,
      endIndex,
      topSpacerHeight: getRowTop(startIndex),
      bottomSpacerHeight: getRowTop(itemCount) - getRowTop(endIndex),
    });
  }, [
    isEnabled,
    itemCount,
    maxVisibleRows,
    overscanRows,
    rowHeightPx,
    rowOffsetsPx,
    scrollContainerRef,
    listStartAnchorRef,
    setStateIfChanged,
  ]);

  // The frame runs the latest recompute: rows that changed after it was scheduled (a resize
  // re-wraps the lines) must not get a window worked out from the old ones.
  const recomputeRef = useRef(recomputeWindow);
  recomputeRef.current = recomputeWindow;
  const scheduleRecompute = useCallback(() => {
    if (frameRef.current !== null) return;

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      recomputeRef.current();
    });
  }, []);

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
    if (!scrollContainer) return undefined;

    const observer = new ResizeObserver(() => {
      scheduleRecompute();
    });
    observer.observe(scrollContainer);
    const listStartAnchor = listStartAnchorRef?.current;
    if (listStartAnchor) observer.observe(listStartAnchor);
    return () => {
      observer.disconnect();
    };
  }, [isEnabled, scheduleRecompute, scrollContainerRef, listStartAnchorRef, itemCount]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return useMemo(() => ({
    ...windowState,
    scheduleRecompute,
  }), [scheduleRecompute, windowState]);
}
