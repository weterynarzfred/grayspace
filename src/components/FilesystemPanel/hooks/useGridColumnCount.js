import { useEffect, useState } from "react";

export default function useGridColumnCount(containerRef, itemMinWidthPx, gapPx = 8, paddingPx = 8) {
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return undefined;

    const compute = () => {
      const availableWidth = container.clientWidth - 2 * paddingPx;
      const cols = Math.max(1, Math.floor((availableWidth + gapPx) / (itemMinWidthPx + gapPx)));
      setColumnCount(cols);
    };

    compute();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(compute);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, gapPx, itemMinWidthPx, paddingPx]);

  return columnCount;
}
