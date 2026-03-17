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

  it("selects window tabs and active tab", () => {
    const windowState = selectCurrentWindow(snapshotV1, "window-1");
    const windowTabs = selectTabsForWindow(snapshotV1, windowState);
    const activeTab = selectActiveTab(snapshotV1, windowState);

    expect(windowTabs.map((tab) => tab.tabId)).toEqual(["tab-1", "tab-2"]);
    expect(activeTab?.tabId).toBe("tab-2");
  });
});
