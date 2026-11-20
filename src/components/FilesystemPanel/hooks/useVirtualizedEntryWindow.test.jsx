import { act, renderHook } from "@testing-library/react";
import useVirtualizedEntryWindow from "./useVirtualizedEntryWindow";

const ROW_HEIGHT_PX = 29;

// jsdom has no layout, so the scroll body and the list's start anchor are plain objects with the
// values a browser reports. The rows start 40px into the scroll body (below the breadcrumbs), and
// the body is scrolled 100 rows into the list, with 10 rows in view.
const scrollBody = { scrollTop: 40 + 100 * ROW_HEIGHT_PX, clientHeight: 10 * ROW_HEIGHT_PX };

function renderEntryWindow(listStartAnchor) {
  const { result } = renderHook(() => useVirtualizedEntryWindow({
    itemCount: 1000,
    rowHeightPx: ROW_HEIGHT_PX,
    isEnabled: true,
    scrollContainerRef: { current: scrollBody },
    listStartAnchorRef: { current: listStartAnchor },
  }));
  return result.current;
}

// A list at the very top of its scroll body (no anchor), scrolled to `scrollTop`.
function renderUnanchoredWindow({ itemCount, rowHeightPx, rowOffsetsPx = undefined, scrollTop, clientHeight }) {
  const scrollContainerRef = { current: { scrollTop, clientHeight } };
  const { result } = renderHook(() => useVirtualizedEntryWindow({
    itemCount,
    rowHeightPx,
    rowOffsetsPx,
    isEnabled: true,
    scrollContainerRef,
  }));
  return result.current;
}

// Folder lines of 30px and tile lines of 170px alternate: line 2k starts at 200k px and line
// 2k + 1 at 200k + 30 px. The last value is the total height.
function getAlternatingLineOffsets(lineCount) {
  return Array.from({ length: lineCount + 1 }, (_, index) => 200 * Math.floor(index / 2) + (index % 2) * 30);
}

const LINE_OFFSETS_PX = getAlternatingLineOffsets(100);

describe("useVirtualizedEntryWindow", () => {
  // In the app the body is the anchor's offsetParent because .panelScrollBody positions it.
  it("starts at the scrolled-to row when the scroll body is the anchor's offsetParent", () => {
    const anchor = { offsetTop: 40, offsetParent: scrollBody };

    expect(renderEntryWindow(anchor)).toMatchObject({ startIndex: 90, endIndex: 120 });
  });

  // Rows of one height window as they did before offsets existed: the rows in view (at most 300)
  // plus 10 on each side, with spacers for the rest.
  it.each([
    ["at the top", 0, 290, { startIndex: 0, endIndex: 20, topSpacerHeight: 0, bottomSpacerHeight: 980 * ROW_HEIGHT_PX }],
    ["part-way into row 100", 100 * ROW_HEIGHT_PX + 15, 290, {
      startIndex: 90, endIndex: 120, topSpacerHeight: 90 * ROW_HEIGHT_PX, bottomSpacerHeight: 880 * ROW_HEIGHT_PX,
    }],
    ["at the end", 990 * ROW_HEIGHT_PX, 290, {
      startIndex: 980, endIndex: 1000, topSpacerHeight: 980 * ROW_HEIGHT_PX, bottomSpacerHeight: 0,
    }],
    ["past the end", 2000 * ROW_HEIGHT_PX, 290, {
      startIndex: 1000, endIndex: 1000, topSpacerHeight: 1000 * ROW_HEIGHT_PX, bottomSpacerHeight: 0,
    }],
    ["with 400 rows in view", 0, 400 * ROW_HEIGHT_PX, {
      startIndex: 0, endIndex: 310, topSpacerHeight: 0, bottomSpacerHeight: 690 * ROW_HEIGHT_PX,
    }],
  ])("windows rows of one height %s", (_, scrollTop, clientHeight, expectedWindow) => {
    expect(renderUnanchoredWindow({ itemCount: 1000, rowHeightPx: ROW_HEIGHT_PX, scrollTop, clientHeight }))
      .toMatchObject(expectedWindow);
  });

  it.each([
    // Lines 0-4 meet the 400px view (line 4 starts at its bottom edge).
    ["at the top", 0, { startIndex: 0, endIndex: 15, topSpacerHeight: 0, bottomSpacerHeight: 10000 - 1430 }],
    // 5100px is inside tile line 51 (5030-5200px), and lines 51-55 meet the view.
    ["part-way into a line", 5100, { startIndex: 41, endIndex: 66, topSpacerHeight: 4030, bottomSpacerHeight: 10000 - 6600 }],
    // A shrunk list can leave the body scrolled past its end for a moment: the last line counts as in view.
    ["past the end", 20000, { startIndex: 89, endIndex: 100, topSpacerHeight: 8830, bottomSpacerHeight: 0 }],
  ])("windows rows of different heights by their offsets %s", (_, scrollTop, expectedWindow) => {
    expect(renderUnanchoredWindow({
      itemCount: 100,
      rowHeightPx: 170,
      rowOffsetsPx: LINE_OFFSETS_PX,
      scrollTop,
      clientHeight: 400,
    })).toMatchObject(expectedWindow);
  });

  it("caps the rows in view at 300 with offsets too", () => {
    // All 1000 lines (100000px) fit in the view; line 310 starts at 31000px.
    expect(renderUnanchoredWindow({
      itemCount: 1000,
      rowHeightPx: 170,
      rowOffsetsPx: getAlternatingLineOffsets(1000),
      scrollTop: 0,
      clientHeight: 100000,
    })).toMatchObject({ startIndex: 0, endIndex: 310, topSpacerHeight: 0, bottomSpacerHeight: 100000 - 31000 });
  });

  // The first line grows from 30 to 170px (a loading line became tiles), so every later line
  // starts 140px further down: line 49 (4830 + 140px) is now the one at 5100px.
  const GROWN_LINE_OFFSETS_PX = LINE_OFFSETS_PX.map((offset, index) => (index === 0 ? 0 : offset + 140));
  const GROWN_LINE_WINDOW = {
    startIndex: 39,
    endIndex: 64,
    topSpacerHeight: 3830 + 140,
    bottomSpacerHeight: 10140 - (6400 + 140),
  };

  function renderLineWindow() {
    const scrollContainerRef = { current: { scrollTop: 5100, clientHeight: 400 } };
    return renderHook(({ rowOffsetsPx }) => useVirtualizedEntryWindow({
      itemCount: 100,
      rowHeightPx: 170,
      rowOffsetsPx,
      isEnabled: true,
      scrollContainerRef,
    }), { initialProps: { rowOffsetsPx: LINE_OFFSETS_PX } });
  }

  it("recomputes when the offsets change but the row count doesn't", () => {
    const { result, rerender } = renderLineWindow();
    expect(result.current).toMatchObject({ startIndex: 41, topSpacerHeight: 4030 });

    rerender({ rowOffsetsPx: GROWN_LINE_OFFSETS_PX });

    expect(result.current).toMatchObject(GROWN_LINE_WINDOW);
  });

  it("windows by the new offsets in a frame scheduled before they changed", () => {
    const frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => frames.push(callback));
    const { result, rerender } = renderLineWindow();

    // A resize schedules a frame, and the lines it re-wraps render before the frame runs.
    act(() => result.current.scheduleRecompute());
    rerender({ rowOffsetsPx: GROWN_LINE_OFFSETS_PX });
    act(() => frames.forEach((runFrame) => runFrame()));

    expect(result.current).toMatchObject(GROWN_LINE_WINDOW);
  });

  describe("scrollRowIntoView", () => {
    // The rows start 40px into the scroll body, which is scrolled 100 rows into the list with 10
    // rows in view: rows 100-109.
    function renderScrollableWindow({
      itemCount = 1000,
      rowOffsetsPx = undefined,
      scrollTop = 40 + 100 * ROW_HEIGHT_PX,
      clientHeight = 10 * ROW_HEIGHT_PX,
    } = {}) {
      const scrollContainer = { scrollTop, clientHeight };
      const listStartAnchor = { offsetTop: 40, offsetParent: scrollContainer };
      const { result } = renderHook(() => useVirtualizedEntryWindow({
        itemCount,
        rowHeightPx: ROW_HEIGHT_PX,
        rowOffsetsPx,
        isEnabled: true,
        scrollContainerRef: { current: scrollContainer },
        listStartAnchorRef: { current: listStartAnchor },
      }));
      return { scrollContainer, scrollRowIntoView: result.current.scrollRowIntoView };
    }

    it("scrolls up to a row above the view until its top is at the view's top", () => {
      const { scrollContainer, scrollRowIntoView } = renderScrollableWindow();

      scrollRowIntoView(20);

      expect(scrollContainer.scrollTop).toBe(40 + 20 * ROW_HEIGHT_PX);
    });

    it("stops a row it scrolls up to below the covered top of the view (a sticky header)", () => {
      const { scrollContainer, scrollRowIntoView } = renderScrollableWindow();

      scrollRowIntoView(20, 30);

      expect(scrollContainer.scrollTop).toBe(40 + 20 * ROW_HEIGHT_PX - 30);
    });

    it("scrolls down to a row below the view until its bottom is at the view's bottom", () => {
      const { scrollContainer, scrollRowIntoView } = renderScrollableWindow();

      scrollRowIntoView(500);

      expect(scrollContainer.scrollTop).toBe(40 + 501 * ROW_HEIGHT_PX - 10 * ROW_HEIGHT_PX);
    });

    it.each([100, 109])("leaves the view where it is for row %i, which is in it", (index) => {
      const { scrollContainer, scrollRowIntoView } = renderScrollableWindow();

      scrollRowIntoView(index);

      expect(scrollContainer.scrollTop).toBe(40 + 100 * ROW_HEIGHT_PX);
    });

    it("finds rows of different heights by their offsets", () => {
      // A 400px view, 5100px into the lines.
      const { scrollContainer, scrollRowIntoView } = renderScrollableWindow({
        itemCount: 100,
        rowOffsetsPx: LINE_OFFSETS_PX,
        scrollTop: 40 + 5100,
        clientHeight: 400,
      });

      // Tile line 81 spans 8030-8200px; folder line 10 starts at 1000px.
      scrollRowIntoView(81);
      expect(scrollContainer.scrollTop).toBe(40 + 8200 - 400);
      scrollRowIntoView(10);
      expect(scrollContainer.scrollTop).toBe(40 + 1000);
    });
  });
});
