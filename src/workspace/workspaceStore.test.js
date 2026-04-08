import {
  initialWorkspaceViewState,
  workspaceReducer,
  selectCurrentWindow,
  selectTabsForWindow,
  selectActiveTab,
} from "./workspaceStore";

describe("workspaceStore", () => {
  const snapshotV1 = {
    revision: 1,
    windows: [
      {
        windowId: "window-1",
        label: "main",
        tabOrder: ["tab-1", "tab-2"],
        activeTabId: "tab-2",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      },
    ],
    tabs: [
      { tabId: "tab-1", title: "Tab 1" },
      { tabId: "tab-2", title: "Tab 2" },
    ],
  };

  it("stores bootstrap payload and current window", () => {
    const nextState = workspaceReducer(initialWorkspaceViewState, {
      type: "workspace/bootstrap",
      payload: { windowId: "window-1", snapshot: snapshotV1 },
    });

    expect(nextState.currentWindowId).toBe("window-1");
    expect(nextState.snapshot).toEqual(snapshotV1);
  });

  it("ignores bootstrap payloads missing snapshot or window id", () => {
    const missingSnapshot = workspaceReducer(initialWorkspaceViewState, {
      type: "workspace/bootstrap",
      payload: { windowId: "window-1" },
    });
    const missingWindowId = workspaceReducer(initialWorkspaceViewState, {
      type: "workspace/bootstrap",
      payload: { snapshot: snapshotV1 },
    });

    expect(missingSnapshot).toBe(initialWorkspaceViewState);
    expect(missingWindowId).toBe(initialWorkspaceViewState);
  });

  it("ignores bootstrap action without payload", () => {
    const nextState = workspaceReducer(initialWorkspaceViewState, {
      type: "workspace/bootstrap",
    });
    expect(nextState).toBe(initialWorkspaceViewState);
  });

  it("ignores stale snapshot revisions", () => {
    const state = workspaceReducer(initialWorkspaceViewState, {
      type: "workspace/bootstrap",
      payload: { windowId: "window-1", snapshot: snapshotV1 },
    });

    const staleState = workspaceReducer(state, {
      type: "workspace/snapshot",
      payload: { snapshot: { ...snapshotV1, revision: 1 } },
    });

    expect(staleState).toBe(state);
  });

  it("accepts newer snapshot revisions", () => {
    const state = workspaceReducer(initialWorkspaceViewState, {
      type: "workspace/bootstrap",
      payload: { windowId: "window-1", snapshot: snapshotV1 },
    });
    const snapshotV2 = { ...snapshotV1, revision: 2 };

    const nextState = workspaceReducer(state, {
      type: "workspace/snapshot",
      payload: { snapshot: snapshotV2 },
    });

    expect(nextState).not.toBe(state);
    expect(nextState.snapshot).toEqual(snapshotV2);
    expect(nextState.currentWindowId).toBe("window-1");
  });

  it("ignores snapshot action without snapshot payload", () => {
    const nextState = workspaceReducer(initialWorkspaceViewState, {
      type: "workspace/snapshot",
      payload: {},
    });
    expect(nextState).toBe(initialWorkspaceViewState);
  });

  it("returns same state for unknown actions", () => {
    const nextState = workspaceReducer(initialWorkspaceViewState, {
      type: "workspace/unknown",
    });
    expect(nextState).toBe(initialWorkspaceViewState);
  });

  it("selects window tabs and active tab", () => {
    const windowState = selectCurrentWindow(snapshotV1, "window-1");
    const windowTabs = selectTabsForWindow(snapshotV1, windowState);
    const activeTab = selectActiveTab(snapshotV1, windowState);

    expect(windowTabs.map((tab) => tab.tabId)).toEqual(["tab-1", "tab-2"]);
    expect(activeTab?.tabId).toBe("tab-2");
  });

  it("handles missing selection inputs safely", () => {
    expect(selectCurrentWindow(null, "window-1")).toBeNull();
    expect(selectCurrentWindow(snapshotV1, "")).toBeNull();
    expect(selectCurrentWindow(snapshotV1, "missing")).toBeNull();

    expect(selectTabsForWindow(null, snapshotV1.windows[0])).toEqual([]);
    expect(selectTabsForWindow(snapshotV1, null)).toEqual([]);

    expect(selectActiveTab(null, snapshotV1.windows[0])).toBeNull();
    expect(selectActiveTab(snapshotV1, null)).toBeNull();
  });

  it("filters tab order entries not present in tab snapshot", () => {
    const snapshotWithDanglingOrder = {
      ...snapshotV1,
      windows: [
        {
          ...snapshotV1.windows[0],
          tabOrder: ["tab-2", "missing", "tab-1"],
        },
      ],
    };
    const windowState = selectCurrentWindow(snapshotWithDanglingOrder, "window-1");
    const windowTabs = selectTabsForWindow(snapshotWithDanglingOrder, windowState);

    expect(windowTabs.map(tab => tab.tabId)).toEqual(["tab-2", "tab-1"]);
  });

  it("falls back to first ordered tab when active tab id is missing", () => {
    const snapshotWithoutActiveMatch = {
      ...snapshotV1,
      windows: [
        {
          ...snapshotV1.windows[0],
          activeTabId: "missing",
        },
      ],
    };
    const windowState = selectCurrentWindow(snapshotWithoutActiveMatch, "window-1");
    const activeTab = selectActiveTab(snapshotWithoutActiveMatch, windowState);

    expect(activeTab?.tabId).toBe("tab-1");
  });

  it("returns null for active tab when tab order has no matching tabs", () => {
    const snapshotWithoutTabMatches = {
      ...snapshotV1,
      windows: [
        {
          ...snapshotV1.windows[0],
          activeTabId: "missing",
          tabOrder: ["unknown-a", "unknown-b"],
        },
      ],
    };
    const windowState = selectCurrentWindow(snapshotWithoutTabMatches, "window-1");
    const activeTab = selectActiveTab(snapshotWithoutTabMatches, windowState);

    expect(activeTab).toBeNull();
  });
});
