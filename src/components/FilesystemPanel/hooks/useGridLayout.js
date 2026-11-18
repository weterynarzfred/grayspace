import { useLayoutEffect, useState } from "react";

// As many columns of at least `minCellWidthPx` as fit in `gridElement`; the cells share the spare
// width. Measured before paint, so a size change never shows a frame of the old layout.
export default function useGridLayout(gridElement, minCellWidthPx, gapPx = 8, paddingPx = 8) {
  const [columnCount, setColumnCount] = useState(1);
  const [cellWidthPx, setCellWidthPx] = useState(minCellWidthPx);

  useLayoutEffect(() => {
    if (!gridElement) return undefined;

    const compute = () => {
      const availableWidth = gridElement.clientWidth - 2 * paddingPx;
      const columns = Math.max(1, Math.floor((availableWidth + gapPx) / (minCellWidthPx + gapPx)));
      setColumnCount(columns);
      // The grid reads 0 px wide while it is detached: on mount it is first measured just after
      // the folder's loading state took it out of the page.
      setCellWidthPx(Math.max(minCellWidthPx, Math.floor((availableWidth - (columns - 1) * gapPx) / columns)));
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(gridElement);
    return () => observer.disconnect();
  }, [gapPx, gridElement, minCellWidthPx, paddingPx]);

  return { columnCount, cellWidthPx };
}
