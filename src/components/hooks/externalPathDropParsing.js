const URI_MATCH = /(?:file|vscode|vscode-file):\/\/[^\s"'<>)}\],;]+/gi;
const ABS_PATH_MATCH = /[A-Za-z]:[\\/][^\s"'<>)}\],;]+|\\\\[^\s"'<>)}\],;]+|[A-Za-z]%3A[\\/][^\s"'<>)}\],;]+/gi;

const isString = (value) => typeof value === "string";
const isObj = (value) => value && typeof value === "object";
const trim = (value) => (isString(value) ? value.trim() : "");

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function trimQuotes(value) {
  const nextValue = trim(value);
  if (nextValue.length < 2) return nextValue;
  const first = nextValue[0];
  if ((first !== "\"" && first !== "'") || first !== nextValue[nextValue.length - 1]) return nextValue;
  return nextValue.slice(1, -1).trim();
}

function collapseBackslashes(value) {
  const withBackslashes = value.replace(/\//g, "\\");
  if (!withBackslashes.startsWith("\\\\")) return withBackslashes.replace(/\\+/g, "\\");
  return `\\\\${withBackslashes.slice(2).replace(/\\+/g, "\\")}`;
}

function stripDevicePrefix(value) {
  if (/^\\\\\?\\UNC\\/i.test(value)) return `\\\\${value.slice(8)}`;
  if (/^\/\/\?\/UNC\//i.test(value)) return `\\\\${value.slice(8)}`;
  return value
    .replace(/^\\\\\?\\/, "")
    .replace(/^\/\/\?\//, "")
    .replace(/^\\\\\.\\/, "")
    .replace(/^\/\/\.\//, "");
}

function normalizeAbsolutePath(value) {
  const nextValue = trimQuotes(value);
  if (!nextValue) return "";

  if (/^\/[A-Za-z]:[\\/]/.test(nextValue)) return normalizeAbsolutePath(nextValue.slice(1));

  const withoutPrefix = stripDevicePrefix(nextValue);
  if (!withoutPrefix) return "";
  return collapseBackslashes(withoutPrefix).replace(/^([a-z]):/, (_, letter) => `${letter.toUpperCase()}:`);
}

function fromUri(value) {
  const uri = trim(value);
  if (!uri) return "";

  try {
    const parsed = new URL(uri);
    const protocol = parsed.protocol.toLowerCase();

    if (protocol === "file:") {
      const pathFromUri = decode(parsed.pathname);
      if (parsed.host) return normalizeAbsolutePath(`\\\\${parsed.host}${pathFromUri}`);
      return normalizeAbsolutePath(pathFromUri);
    }

    const decoded = decode(`${parsed.host}${parsed.pathname}`);
    const drivePath = decoded.match(/([A-Za-z]:[\\/][^?#]*)/)?.[1];
    if (drivePath) return normalizeAbsolutePath(drivePath);
    if (decoded.startsWith("//")) return normalizeAbsolutePath(decoded);
  } catch {
    return "";
  }

  return "";
}

function isAbsolutePath(value) {
  return (
    /^[A-Za-z]:[\\/]/.test(value)
    || /^\\\\/.test(value)
    || /^\\\\\?\\/.test(value)
    || /^\/\/\?\//.test(value)
    || /^\//.test(value)
  );
}

function toPathCandidate(rawValue) {
  if (!isString(rawValue)) return "";
  const value = trimQuotes(rawValue);
  if (!value || /\r|\n/.test(value)) return "";

  const embeddedUri = value.match(/(?:file|vscode|vscode-file):\/\/[^\s"'<>)}\],;]+/i)?.[0];
  if (embeddedUri) {
    const pathFromEmbeddedUri = fromUri(embeddedUri);
    if (pathFromEmbeddedUri) return pathFromEmbeddedUri;
  }

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return fromUri(value);
  if (isAbsolutePath(value)) return normalizeAbsolutePath(value);

  const decoded = decode(value);
  return decoded === value ? "" : toPathCandidate(decoded);
}

export function externalPathKey(path) {
  return normalizeAbsolutePath(path)
    .trim()
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\/\/\?\/UNC\//i, "\\\\")
    .replace(/[\\/]+/g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

export function uniqueExternalPaths(paths) {
  if (!Array.isArray(paths)) return [];
  const seen = new Set();
  const out = [];

  for (const rawPath of paths) {
    if (!isString(rawPath) || !trim(rawPath)) continue;
    const normalizedPath = toPathCandidate(rawPath) || trim(rawPath);
    const key = externalPathKey(normalizedPath);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(normalizedPath);
  }

  return out;
}

function parseMultiline(value) {
  if (!isString(value) || !trim(value)) return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(toPathCandidate)
    .filter(Boolean);
}

function parseDownloadUrl(value) {
  if (!isString(value) || !trim(value)) return [];
  const firstColon = value.indexOf(":");
  const secondColon = value.indexOf(":", firstColon + 1);
  if (firstColon < 0 || secondColon < 0) return [];
  const path = toPathCandidate(value.slice(secondColon + 1).trim());
  return path ? [path] : [];
}

function collectFromString(value, out) {
  if (!isString(value) || !trim(value)) return;

  const directPath = toPathCandidate(value);
  if (directPath) out.push(directPath);
  out.push(...parseMultiline(value));

  for (const match of value.matchAll(URI_MATCH)) {
    const pathFromUri = toPathCandidate(match[0]);
    if (pathFromUri) out.push(pathFromUri);
  }

  for (const match of value.matchAll(ABS_PATH_MATCH)) {
    const pathFromAbs = toPathCandidate(match[0]);
    if (pathFromAbs) out.push(pathFromAbs);
  }
}

function collectFromJson(value, out) {
  if (isString(value)) {
    collectFromString(value, out);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectFromJson(item, out));
    return;
  }

  if (!isObj(value)) return;

  const rawPath = isString(value.path) ? value.path : (isString(value.fsPath) ? value.fsPath : "");
  if (rawPath) {
    const path = toPathCandidate(rawPath);
    if (path) out.push(path);
  }

  const scheme = isString(value.scheme) ? value.scheme.toLowerCase().trim() : "";
  if (rawPath && ["file", "vscode", "vscode-file"].includes(scheme)) {
    const authority = isString(value.authority) ? value.authority : (isString(value.host) ? value.host : "");
    const uriPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    const path = toPathCandidate(`${scheme}://${authority}${uriPath}`);
    if (path) out.push(path);
  }

  Object.values(value).forEach((entry) => collectFromJson(entry, out));
}

function parseUnknownPayload(value) {
  if (!isString(value) || !trim(value)) return [];
  const out = [];
  collectFromString(value, out);
  try {
    collectFromJson(JSON.parse(value), out);
  } catch {
    // ignore non-json payload
  }
  return uniqueExternalPaths(out);
}

function parseByMimeType(payload, mimeType) {
  const normalizedMime = trim(mimeType).toLowerCase();
  if (normalizedMime.includes("uri-list")) return parseMultiline(payload);
  if (normalizedMime.includes("downloadurl")) return parseDownloadUrl(payload);
  return parseUnknownPayload(payload);
}

function fileLikePath(fileLike) {
  if (!isObj(fileLike)) return "";
  if (isString(fileLike.path) && fileLike.path) return fileLike.path;
  if (isString(fileLike.webkitRelativePath) && fileLike.webkitRelativePath) return fileLike.webkitRelativePath;
  return "";
}

function readStringItem(item) {
  return new Promise((resolve) => {
    if (typeof item?.getAsString !== "function") {
      resolve("");
      return;
    }

    try {
      item.getAsString((value) => resolve(isString(value) ? value : ""));
    } catch {
      resolve("");
    }
  });
}

export function hasExternalPayload(dataTransfer) {
  if (!dataTransfer) return false;
  return (
    (dataTransfer.files?.length ?? 0) > 0
    || (dataTransfer.items?.length ?? 0) > 0
    || (dataTransfer.types?.length ?? 0) > 0
  );
}

export function extractExternalPathsFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return [];

  const out = [];

  for (const fileLike of Array.from(dataTransfer.files ?? [])) {
    const path = fileLikePath(fileLike);
    if (path) out.push(path);
  }

  for (const item of Array.from(dataTransfer.items ?? [])) {
    if (item?.kind !== "file") continue;
    const path = fileLikePath(item.getAsFile?.());
    if (path) out.push(path);
  }

  for (const type of Array.from(dataTransfer.types ?? []).filter(isString)) {
    try {
      const payload = dataTransfer.getData(type);
      if (!payload) continue;
      out.push(...parseByMimeType(payload, type));
    } catch {
      // ignore unsupported payload read
    }
  }

  return uniqueExternalPaths(out);
}

export async function extractExternalPathsFromDataTransferItems(dataTransfer) {
  const stringItems = Array.from(dataTransfer?.items ?? []).filter((item) => (
    item?.kind === "string" && typeof item?.getAsString === "function"
  ));
  if (stringItems.length === 0) return [];

  const out = [];
  await Promise.all(stringItems.map(async (item) => {
    const payload = await readStringItem(item);
    if (!payload) return;
    out.push(...parseByMimeType(payload, item.type));
  }));

  return uniqueExternalPaths(out);
}
