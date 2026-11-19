import { useLayoutEffect, useState } from "react";

// As many columns of at least `minCellWidthPx` as fit in `widthPx`, but at least one; the cells
// share the spare width. A cell is never narrower than `minCellWidthPx`: the grid reads 0 px wide
// while it is detached (on mount it is first measured just after the folder's loading state took
// it out of the page), and a deep foldable-grid line can be narrower than one cell.
export function fitGridColumns(widthPx, minCellWidthPx, gapPx) {
  const columnCount = Math.max(1, Math.floor((widthPx + gapPx) / (minCellWidthPx + gapPx)));
  const cellWidthPx = Math.max(minCellWidthPx, Math.floor((widthPx - (columnCount - 1) * gapPx) / columnCount));
  return { columnCount, cellWidthPx };
}

// The columns that fit in `gridElement` (fitGridColumns). availableWidthPx is the width inside the
// padding that the columns are fitted to, kept only with `tracksAvailableWidth`: it changes with
// every pixel of a resize, and as state it would render the whole grid again each time. Measured
// before paint, so a size change never shows a frame of the old layout.
export default function useGridLayout(
  gridElement,
  minCellWidthPx,
  gapPx = 8,
  paddingPx = 8,
  tracksAvailableWidth = false,
) {
  const [columnCount, setColumnCount] = useState(1);
  const [cellWidthPx, setCellWidthPx] = useState(minCellWidthPx);
  const [availableWidthPx, setAvailableWidthPx] = useState(0);

  useLayoutEffect(() => {
    if (!gridElement) return undefined;

    const compute = () => {
      const availableWidth = gridElement.clientWidth - 2 * paddingPx;
      const fit = fitGridColumns(availableWidth, minCellWidthPx, gapPx);
      if (tracksAvailableWidth) setAvailableWidthPx(Math.max(0, availableWidth));
      setColumnCount(fit.columnCount);
      setCellWidthPx(fit.cellWidthPx);
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(gridElement);
    return () => observer.disconnect();
  }, [gapPx, gridElement, minCellWidthPx, paddingPx, tracksAvailableWidth]);

  return { columnCount, cellWidthPx, availableWidthPx };
}
