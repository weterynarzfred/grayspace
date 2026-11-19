import { renderHook } from "@testing-library/react";
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

describe("useVirtualizedEntryWindow", () => {
  // In the app the body is the anchor's offsetParent because .panelScrollBody positions it.
  it("starts at the scrolled-to row when the scroll body is the anchor's offsetParent", () => {
    const anchor = { offsetTop: 40, offsetParent: scrollBody };

    expect(renderEntryWindow(anchor)).toMatchObject({ startIndex: 90, endIndex: 120 });
  });
});
