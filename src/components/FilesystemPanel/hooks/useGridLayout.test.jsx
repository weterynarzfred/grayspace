import { act, renderHook } from "@testing-library/react";
import useGridLayout, { fitGridColumns } from "./useGridLayout";

// jsdom has no layout, so the grid is a plain object with the width a browser reports. Cells are
// at least 138px wide (a 128px thumbnail plus the cell's padding and border), 8px apart, inside
// 8px of padding.
function renderGridLayout(gridElement, tracksAvailableWidth = true) {
  return renderHook(() => useGridLayout(gridElement, 138, 8, 8, tracksAvailableWidth)).result;
}

// Lets the test report the grid's resizes, as a browser's ResizeObserver would.
function stubResizeObserver() {
  let reportResize;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback) {
      reportResize = callback;
    }

    observe() { /* the test reports the resize itself */ }

    disconnect() { /* nothing to release */ }
  });
  return () => act(() => reportResize());
}

describe("fitGridColumns", () => {
  it("fits as many cells as there is room for, sharing the spare width, but at least one", () => {
    expect(fitGridColumns(584, 138, 8)).toEqual({ columnCount: 4, cellWidthPx: 140 });
    expect(fitGridColumns(560, 138, 8)).toEqual({ columnCount: 3, cellWidthPx: 181 });
    expect(fitGridColumns(100, 138, 8)).toEqual({ columnCount: 1, cellWidthPx: 138 });
    expect(fitGridColumns(-16, 138, 8)).toEqual({ columnCount: 1, cellWidthPx: 138 });
  });

  it("counts a cell that fits exactly", () => {
    expect(fitGridColumns(3 * 138 + 2 * 8, 138, 8)).toEqual({ columnCount: 3, cellWidthPx: 138 });
    expect(fitGridColumns(3 * 138 + 2 * 8 - 1, 138, 8)).toEqual({ columnCount: 2, cellWidthPx: 210 });
  });
});

describe("useGridLayout", () => {
  it("returns the width inside the padding that the columns are fitted to", () => {
    // 600px less the padding leaves 584px: 4 cells of 140px and 3 gaps.
    expect(renderGridLayout({ clientWidth: 600 }).current)
      .toEqual({ columnCount: 4, cellWidthPx: 140, availableWidthPx: 584 });
  });

  it("reads a grid that is not laid out yet as 0px wide, not less", () => {
    expect(renderGridLayout({ clientWidth: 0 }).current)
      .toEqual({ columnCount: 1, cellWidthPx: 138, availableWidthPx: 0 });
  });

  it("measures again when the grid is resized", () => {
    const reportResize = stubResizeObserver();
    const gridElement = { clientWidth: 600 };
    const result = renderGridLayout(gridElement);

    gridElement.clientWidth = 316;
    reportResize();

    // 300px inside the padding: 2 cells of 146px and one gap.
    expect(result.current).toEqual({ columnCount: 2, cellWidthPx: 146, availableWidthPx: 300 });
  });

  it("renders nothing again for a resize that keeps the columns and their width, unless it tracks the width", () => {
    const reportResize = stubResizeObserver();
    const gridElement = { clientWidth: 600 };
    let renderCount = 0;
    const { result, rerender } = renderHook(({ tracksAvailableWidth }) => {
      renderCount += 1;
      return useGridLayout(gridElement, 138, 8, 8, tracksAvailableWidth);
    }, { initialProps: { tracksAvailableWidth: false } });
    const settledRenderCount = renderCount;

    // 585 to 587px still hold 4 cells of 140px. React may call the hook once more before it skips
    // such updates, but not on every resize.
    [601, 602, 603].forEach((clientWidth) => {
      gridElement.clientWidth = clientWidth;
      reportResize();
    });
    expect(renderCount).toBeLessThanOrEqual(settledRenderCount + 1);

    rerender({ tracksAvailableWidth: true });
    gridElement.clientWidth = 602;
    reportResize();
    expect(result.current).toEqual({ columnCount: 4, cellWidthPx: 140, availableWidthPx: 586 });
  });
});
