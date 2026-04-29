const PREVIEW_TAB_DRAG_PREFIX = "preview-tab-drag:";
const PREVIEW_TAB_DROP_PREFIX = "preview-tab-drop:";
const PREVIEW_TAB_BAR_DROP_PREFIX = "preview-tab-bar-drop:";

function normalizePath(path = "") {
  return typeof path === "string" ? path.trim() : "";
}

export function getPreviewTabDragId(paneId = "", path = "") {
  const normalizedPath = normalizePath(path);
  return `${PREVIEW_TAB_DRAG_PREFIX}${paneId}:${normalizedPath}`;
}

export function getPreviewTabDropId(paneId = "", path = "", side = "right") {
  const normalizedPath = normalizePath(path);
  const normalizedSide = side === "left" ? "left" : "right";
  return `${PREVIEW_TAB_DROP_PREFIX}${paneId}:${normalizedSide}:${normalizedPath}`;
}

export function getPreviewTabBarDropId(paneId = "") {
  return `${PREVIEW_TAB_BAR_DROP_PREFIX}${paneId}`;
}

export function parsePreviewTabDropId(id = "") {
  const value = String(id ?? "");
  if (value.startsWith(PREVIEW_TAB_DROP_PREFIX)) {
    const rawValue = value.slice(PREVIEW_TAB_DROP_PREFIX.length);
    const firstDelimiter = rawValue.indexOf(":");
    const secondDelimiter = rawValue.indexOf(":", firstDelimiter + 1);
    if (firstDelimiter < 0 || secondDelimiter < 0) {
      return { kind: "", paneId: "", path: "", side: "right" };
    }

    const paneId = rawValue.slice(0, firstDelimiter);
    const sideValue = rawValue.slice(firstDelimiter + 1, secondDelimiter);
    const path = normalizePath(rawValue.slice(secondDelimiter + 1));
    if (!paneId || !path) {
      return { kind: "", paneId: "", path: "", side: "right" };
    }

    return {
      kind: "tab",
      paneId,
      path,
      side: sideValue === "left" ? "left" : "right",
    };
  }

  if (value.startsWith(PREVIEW_TAB_BAR_DROP_PREFIX)) {
    const paneId = value.slice(PREVIEW_TAB_BAR_DROP_PREFIX.length);
    if (!paneId) {
      return { kind: "", paneId: "", path: "", side: "right" };
    }

    return {
      kind: "bar",
      paneId,
      path: "",
      side: "right",
    };
  }

  return { kind: "", paneId: "", path: "", side: "right" };
}
