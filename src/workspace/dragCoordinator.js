const TAB_DND_PREFIX = "tab:";

export function getTabDndId(tabId) {
  return `${TAB_DND_PREFIX}${tabId}`;
}

export function parseTabDndId(rawId) {
  const asString = String(rawId ?? "");
  if (!asString.startsWith(TAB_DND_PREFIX)) return "";
  return asString.slice(TAB_DND_PREFIX.length);
}

function isPointWithinBounds(point, bounds) {
  if (!point || !bounds) return false;
  return point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height;
}

export function resolveWindowAtPoint(snapshot, point) {
  if (!snapshot || !point) return null;
  return snapshot.windows.find(window => isPointWithinBounds(point, window.bounds)) ?? null;
}

export function resolveTabDropAction({
  snapshot,
  sourceWindowId,
  tabOrder,
  activeTabId,
  overId,
  pointer,
}) {
  const targetTabId = parseTabDndId(overId);
  if (targetTabId) {
    const targetIndex = tabOrder.indexOf(targetTabId);
    return {
      kind: "move",
      sourceWindowId,
      targetWindowId: sourceWindowId,
      tabId: activeTabId,
      targetIndex: targetIndex >= 0 ? targetIndex : tabOrder.length,
    };
  }

  const targetWindow = resolveWindowAtPoint(snapshot, pointer);
  if (targetWindow && targetWindow.windowId !== sourceWindowId) {
    return {
      kind: "move",
      sourceWindowId,
      targetWindowId: targetWindow.windowId,
      tabId: activeTabId,
      targetIndex: null,
    };
  }
  if (targetWindow && targetWindow.windowId === sourceWindowId) {
    return {
      kind: "noop",
      sourceWindowId,
      tabId: activeTabId,
    };
  }
  if (tabOrder.length <= 1) {
    return {
      kind: "noop",
      sourceWindowId,
      tabId: activeTabId,
    };
  }

  return {
    kind: "detach",
    sourceWindowId,
    tabId: activeTabId,
    point: pointer,
  };
}
