export const initialWorkspaceViewState = {
  snapshot: null,
  currentWindowId: "",
};

export function workspaceReducer(state, action) {
  switch (action.type) {
    case "workspace/bootstrap": {
      const { snapshot, windowId } = action.payload ?? {};
      if (!snapshot || !windowId) return state;
      return { ...state, snapshot, currentWindowId: windowId };
    }
    case "workspace/snapshot": {
      const nextSnapshot = action.payload?.snapshot;
      if (!nextSnapshot) return state;
      if (state.snapshot && nextSnapshot.revision <= state.snapshot.revision) return state;
      return { ...state, snapshot: nextSnapshot };
    }
    default:
      return state;
  }
}

export function selectCurrentWindow(snapshot, windowId) {
  if (!snapshot || !windowId) return null;
  return snapshot.windows.find(window => window.windowId === windowId) ?? null;
}

export function selectTabsForWindow(snapshot, window) {
  if (!snapshot || !window) return [];

  const tabsById = new Map(snapshot.tabs.map(tab => [tab.tabId, tab]));
  return window.tabOrder
    .map(tabId => tabsById.get(tabId))
    .filter(tab => Boolean(tab));
}

export function selectActiveTab(snapshot, window) {
  if (!snapshot || !window) return null;

  return snapshot.tabs.find(tab => tab.tabId === window.activeTabId) ??
    snapshot.tabs.find(tab => window.tabOrder.includes(tab.tabId)) ??
    null;
}
