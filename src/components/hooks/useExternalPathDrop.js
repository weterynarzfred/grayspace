import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

const DUPLICATE_DROP_WINDOW_MS = 120;
const URI_MATCH = /(?:file|vscode|vscode-file):\/\/[^\s"'<>)}\],;]+/gi;
const ABS_PATH_MATCH = /[A-Za-z]:[\\/][^\s"'<>)}\],;]+|\\\\[^\s"'<>)}\],;]+|[A-Za-z]%3A[\\/][^\s"'<>)}\],;]+/gi;

const isString = (value) => typeof value === "string";
const isObj = (value) => value && typeof value === "object";
const trim = (value) => (isString(value) ? value.trim() : "");

function physicalToClientPosition(position) {
  if (!position) return null;
  const ratio = window.devicePixelRatio || 1;
  return { x: position.x / ratio, y: position.y / ratio };
}

function isInsidePanelBounds(panelElement, clientPosition) {
  if (!panelElement || !clientPosition) return false;
  const bounds = panelElement.getBoundingClientRect();
  return (
    clientPosition.x >= bounds.left
    && clientPosition.x <= bounds.right
    && clientPosition.y >= bounds.top
    && clientPosition.y <= bounds.bottom
  );
}

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

function pathKey(path) {
  return normalizeAbsolutePath(path)
    .trim()
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\/\/\?\/UNC\//i, "\\\\")
    .replace(/[\\/]+/g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

function uniquePaths(paths) {
  if (!Array.isArray(paths)) return [];
  const seen = new Set();
  const out = [];

  for (const rawPath of paths) {
    if (!isString(rawPath) || !trim(rawPath)) continue;
    const normalizedPath = toPathCandidate(rawPath) || trim(rawPath);
    const key = pathKey(normalizedPath);
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
  return uniquePaths(out);
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

function hasExternalPayload(dataTransfer) {
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

  return uniquePaths(out);
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

  return uniquePaths(out);
}

function dropSignature(paths) {
  return paths
    .map(pathKey)
    .filter(Boolean)
    .sort()
    .join("\u001f");
}

export default function useExternalPathDrop({
  panelRef,
  isEnabled = true,
  onDropPaths = undefined,
  onExternalDragStateChange = undefined,
}) {
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const isEnabledRef = useRef(isEnabled);
  const onDropPathsRef = useRef(onDropPaths);
  const onExternalDragStateChangeRef = useRef(onExternalDragStateChange);
  const lastDropRef = useRef({ signature: "", atMs: 0 });

  isEnabledRef.current = isEnabled;
  onDropPathsRef.current = onDropPaths;
  onExternalDragStateChangeRef.current = onExternalDragStateChange;

  useEffect(() => {
    let disposed = false;
    let unlistenFn = null;

    const emitDragState = (state) => onExternalDragStateChangeRef.current?.(state);
    const clearHoverState = (source = "dom", phase = "leave") => {
      setIsExternalDragOver(false);
      emitDragState({ source, phase, isInsidePanel: false, clientPosition: null });
    };

    const updateHoverState = (clientPosition, source = "unknown") => {
      const isInsidePanel = Boolean(isEnabledRef.current && isInsidePanelBounds(panelRef.current, clientPosition));
      setIsExternalDragOver(isInsidePanel);
      emitDragState({ source, phase: "over", isInsidePanel, clientPosition });
      return isInsidePanel;
    };

    const triggerDrop = async (paths, context = {}) => {
      const normalizedPaths = uniquePaths(paths);
      if (!isEnabledRef.current || normalizedPaths.length === 0) return;

      const signature = dropSignature(normalizedPaths);
      const nowMs = Date.now();
      if (
        signature
        && signature === lastDropRef.current.signature
        && nowMs - lastDropRef.current.atMs <= DUPLICATE_DROP_WINDOW_MS
      ) {
        return;
      }

      lastDropRef.current = { signature, atMs: nowMs };

      try {
        await onDropPathsRef.current?.(normalizedPaths, context);
      } catch {
        // caller handles user-facing errors
      }
    };

    const handleTauriDragDropEvent = async (event) => {
      const payload = event?.payload;
      if (!payload) return;

      if (payload.type === "leave") {
        clearHoverState("tauri", "leave");
        return;
      }

      const clientPosition = physicalToClientPosition(payload.position);
      const isInside = updateHoverState(clientPosition, "tauri");
      if (payload.type === "enter" || payload.type === "over") return;
      if (payload.type !== "drop" || !isInside) {
        clearHoverState("tauri", "drop");
        return;
      }

      clearHoverState("tauri", "drop");
      await triggerDrop(payload.paths ?? [], {
        source: "tauri",
        clientPosition,
        physicalPosition: payload.position ?? null,
      });
    };

    async function subscribeTauriDragDrop() {
      let appWindow = null;
      try {
        appWindow = getCurrentWindow();
      } catch {
        return;
      }
      if (!appWindow || typeof appWindow.onDragDropEvent !== "function") return;

      try {
        const unlisten = await appWindow.onDragDropEvent(handleTauriDragDropEvent);
        if (disposed) {
          unlisten?.();
          return;
        }
        unlistenFn = unlisten;
      } catch {
        // ignore unavailable drag-drop API in non-tauri environments
      }
    }

    void subscribeTauriDragDrop();

    const handleDocumentDragOver = (event) => {
      if (!hasExternalPayload(event.dataTransfer)) return;
      const clientPosition = { x: event.clientX, y: event.clientY };
      if (updateHoverState(clientPosition, "dom")) event.preventDefault();
    };

    const handleDocumentDrop = async (event) => {
      const clientPosition = { x: event.clientX, y: event.clientY };
      const isInside = isInsidePanelBounds(panelRef.current, clientPosition);
      if (isInside && isEnabledRef.current) event.preventDefault();

      const droppedPaths = uniquePaths([
        ...extractExternalPathsFromDataTransfer(event.dataTransfer),
        ...await extractExternalPathsFromDataTransferItems(event.dataTransfer),
      ]);

      clearHoverState("dom", "drop");
      if (!isInside || droppedPaths.length === 0) return;

      await triggerDrop(droppedPaths, {
        source: "dom",
        clientPosition,
        physicalPosition: null,
      });
    };

    const handleDocumentDragLeave = (event) => {
      if (event.relatedTarget) return;
      clearHoverState("dom", "leave");
    };

    const handleDocumentDragEnd = () => clearHoverState("dom", "leave");

    document.addEventListener("dragover", handleDocumentDragOver);
    document.addEventListener("drop", handleDocumentDrop);
    document.addEventListener("dragleave", handleDocumentDragLeave);
    document.addEventListener("dragend", handleDocumentDragEnd);

    return () => {
      disposed = true;
      if (unlistenFn) unlistenFn();
      document.removeEventListener("dragover", handleDocumentDragOver);
      document.removeEventListener("drop", handleDocumentDrop);
      document.removeEventListener("dragleave", handleDocumentDragLeave);
      document.removeEventListener("dragend", handleDocumentDragEnd);
    };
  }, [panelRef]);

  return { isExternalDragOver };
}
