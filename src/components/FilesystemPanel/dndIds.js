export const dndPrefix = Object.freeze({
  entry: "entry:",
  dragEntry: "drag-entry:",
  breadcrumb: "breadcrumb:",
  up: "up:",
  panel: "panel:",
});

export function toDndId(prefix, path) {
  return `${prefix}${path}`;
}

export function getEntryDndId(path) {
  return toDndId(dndPrefix.entry, path);
}

export function getDragEntryDndId(paneId, path) {
  return `${dndPrefix.dragEntry}${paneId}:${path}`;
}

export function getBreadcrumbDndId(path) {
  return toDndId(dndPrefix.breadcrumb, path);
}

export function getUpDndId(path) {
  return toDndId(dndPrefix.up, path);
}

export function getPanelDndId(path) {
  return toDndId(dndPrefix.panel, path);
}

export function parsePathByPrefix(id, prefix) {
  const asString = String(id ?? "");
  if (!asString.startsWith(prefix)) {
    return "";
  }

  return asString.slice(prefix.length);
}

export function parseEntryPath(id) {
  const entryPath = parsePathByPrefix(id, dndPrefix.entry);
  if (entryPath) {
    return entryPath;
  }

  const dragEntryValue = parsePathByPrefix(id, dndPrefix.dragEntry);
  const delimiterIndex = dragEntryValue.indexOf(":");
  if (delimiterIndex === -1) {
    return "";
  }

  return dragEntryValue.slice(delimiterIndex + 1);
}

export function parseDestinationTarget(id) {
  const entryPath = parsePathByPrefix(id, dndPrefix.entry);
  if (entryPath) {
    return { kind: "entry", path: entryPath };
  }

  const breadcrumbPath = parsePathByPrefix(id, dndPrefix.breadcrumb);
  if (breadcrumbPath) {
    return { kind: "breadcrumb", path: breadcrumbPath };
  }

  const upPath = parsePathByPrefix(id, dndPrefix.up);
  if (upPath) {
    return { kind: "up", path: upPath };
  }

  const panelPath = parsePathByPrefix(id, dndPrefix.panel);
  if (panelPath) {
    return { kind: "panel", path: panelPath };
  }

  return { kind: "", path: "" };
}
