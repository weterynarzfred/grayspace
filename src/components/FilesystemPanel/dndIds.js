export const dndPrefix = Object.freeze({
  entry: "entry:",
  breadcrumb: "breadcrumb:",
  up: "up:",
});

export function toDndId(prefix, path) {
  return `${prefix}${path}`;
}

export function getEntryDndId(path) {
  return toDndId(dndPrefix.entry, path);
}

export function getBreadcrumbDndId(path) {
  return toDndId(dndPrefix.breadcrumb, path);
}

export function getUpDndId(path) {
  return toDndId(dndPrefix.up, path);
}

export function parsePathByPrefix(id, prefix) {
  const asString = String(id ?? "");
  if (!asString.startsWith(prefix)) {
    return "";
  }

  return asString.slice(prefix.length);
}

export function parseEntryPath(id) {
  return parsePathByPrefix(id, dndPrefix.entry);
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

  return { kind: "", path: "" };
}
