import { getTabDndId, resolveTabDropAction } from "./dragCoordinator";

describe("dragCoordinator", () => {
  const snapshot = {
    revision: 3,
    windows: [
      {
        windowId: "window-1",
        bounds: { x: 0, y: 0, width: 500, height: 500 },
      },
      {
        windowId: "window-2",
        bounds: { x: 600, y: 0, width: 500, height: 500 },
      },
    ],
  };

  it("returns in-window move when dropped over another tab", () => {
    const action = resolveTabDropAction({
      snapshot,
      sourceWindowId: "window-1",
      tabOrder: ["tab-1", "tab-2", "tab-3"],
      activeTabId: "tab-1",
      overId: getTabDndId("tab-3"),
      pointer: { x: 250, y: 80 },
    });

    expect(action).toEqual({
      kind: "move",
      sourceWindowId: "window-1",
      targetWindowId: "window-1",
      tabId: "tab-1",
      targetIndex: 2,
    });
  });

  it("returns cross-window move when pointer is over another window", () => {
    const action = resolveTabDropAction({
      snapshot,
      sourceWindowId: "window-1",
      tabOrder: ["tab-1", "tab-2"],
      activeTabId: "tab-2",
      overId: null,
      pointer: { x: 650, y: 20 },
    });

    expect(action).toEqual({
      kind: "move",
      sourceWindowId: "window-1",
      targetWindowId: "window-2",
      tabId: "tab-2",
      targetIndex: null,
    });
  });

  it("returns noop when pointer is outside known windows and source window has one tab", () => {
    const action = resolveTabDropAction({
      snapshot,
      sourceWindowId: "window-1",
      tabOrder: ["tab-1"],
      activeTabId: "tab-1",
      overId: null,
      pointer: { x: 1300, y: 900 },
    });

    expect(action).toEqual({
      kind: "noop",
      sourceWindowId: "window-1",
      tabId: "tab-1",
    });
  });

  it("returns detach action when pointer is outside known windows and source window has many tabs", () => {
    const action = resolveTabDropAction({
      snapshot,
      sourceWindowId: "window-1",
      tabOrder: ["tab-1", "tab-2"],
      activeTabId: "tab-2",
      overId: null,
      pointer: { x: 1300, y: 900 },
    });

    expect(action).toEqual({
      kind: "detach",
      sourceWindowId: "window-1",
      tabId: "tab-2",
      point: { x: 1300, y: 900 },
    });
  });

  it("returns noop when pointer is inside source window without tab target", () => {
    const action = resolveTabDropAction({
      snapshot,
      sourceWindowId: "window-1",
      tabOrder: ["tab-1"],
      activeTabId: "tab-1",
      overId: null,
      pointer: { x: 120, y: 120 },
    });

    expect(action).toEqual({
      kind: "noop",
      sourceWindowId: "window-1",
      tabId: "tab-1",
    });
  });
});
