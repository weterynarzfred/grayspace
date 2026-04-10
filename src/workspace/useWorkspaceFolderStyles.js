import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { jsonrepair } from "jsonrepair";
import { useEffect, useMemo, useRef } from "react";

export const FOLDER_STYLES_ELEMENT_ID = "workspace-folder-styles";
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveWorkspaceRelativeAssetPath(workspaceRoot, rawAssetPath) {
  const normalizedWorkspaceRoot = trimString(workspaceRoot);
  const normalizedRawAssetPath = trimString(rawAssetPath);
  if (!normalizedWorkspaceRoot || !normalizedRawAssetPath) return "";

  if (/^[A-Za-z]:[\\/]/.test(normalizedRawAssetPath)) return "";
  if (normalizedRawAssetPath.startsWith("\\\\")) return "";

  const protocolMatch = normalizedRawAssetPath.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  if (protocolMatch) return "";

  let decodedAssetPath = normalizedRawAssetPath;
  try {
    decodedAssetPath = decodeURIComponent(normalizedRawAssetPath);
  } catch {
    decodedAssetPath = normalizedRawAssetPath;
  }

  let normalizedAssetPath = decodedAssetPath.replace(/\\/g, "/");
  if (normalizedAssetPath.startsWith("/")) {
    normalizedAssetPath = normalizedAssetPath.replace(/^\/+/, "");
  }
  while (normalizedAssetPath.startsWith("./")) {
    normalizedAssetPath = normalizedAssetPath.slice(2);
  }

  const pathSegments = normalizedAssetPath
    .split("/")
    .filter(Boolean)
    .reduce((segments, segment) => {
      if (segment === ".") return segments;
      if (segment === "..") {
        if (segments.length === 0) return null;
        segments.pop();
        return segments;
      }
      segments.push(segment);
      return segments;
    }, []);

  if (!pathSegments || pathSegments.length === 0) return "";

  const separator = normalizedWorkspaceRoot.includes("\\") ? "\\" : "/";
  const trimmedWorkspaceRoot = normalizedWorkspaceRoot.replace(/[\\/]+$/, "");
  return `${trimmedWorkspaceRoot}${separator}${pathSegments.join(separator)}`;
}

function splitUrlAssetReference(rawReference) {
  const questionMarkIndex = rawReference.indexOf("?");
  const hashIndex = rawReference.indexOf("#");
  if (questionMarkIndex === -1 && hashIndex === -1) return [rawReference, ""];
  if (questionMarkIndex === -1) {
    return [rawReference.slice(0, hashIndex), rawReference.slice(hashIndex)];
  }
  if (hashIndex === -1) {
    return [rawReference.slice(0, questionMarkIndex), rawReference.slice(questionMarkIndex)];
  }
  const splitIndex = Math.min(questionMarkIndex, hashIndex);
  return [rawReference.slice(0, splitIndex), rawReference.slice(splitIndex)];
}

export function rewriteStylesheetUrlsForWorkspace(stylesheetText, workspaceRoot) {
  if (typeof stylesheetText !== "string" || !stylesheetText.includes("url(")) return stylesheetText;
  const normalizedWorkspaceRoot = trimString(workspaceRoot);
  if (!normalizedWorkspaceRoot) return stylesheetText;

  return stylesheetText.replace(CSS_URL_PATTERN, (matched, quote, rawReference) => {
    const assetReference = trimString(rawReference);
    if (!assetReference) return matched;

    const lowerReference = assetReference.toLowerCase();
    if (
      lowerReference.startsWith("data:")
      || lowerReference.startsWith("blob:")
      || lowerReference.startsWith("asset:")
      || lowerReference.startsWith("http:")
      || lowerReference.startsWith("https:")
      || lowerReference.startsWith("#")
      || lowerReference.startsWith("var(")
    ) {
      return matched;
    }

    const [assetPath, assetSuffix] = splitUrlAssetReference(assetReference);
    const resolvedAssetPath = resolveWorkspaceRelativeAssetPath(normalizedWorkspaceRoot, assetPath);
    if (!resolvedAssetPath) return matched;

    const rewrittenAssetUrl = `${convertFileSrc(resolvedAssetPath)}${assetSuffix}`;
    const nextQuote = quote || "\"";
    return `url(${nextQuote}${rewrittenAssetUrl}${nextQuote})`;
  });
}

function clearInjectedStyles(styleElementRef) {
  const previousStyleElement = styleElementRef.current;
  if (previousStyleElement?.parentNode) previousStyleElement.parentNode.removeChild(previousStyleElement);
  styleElementRef.current = null;
}

function injectStyles(stylesheetText, styleElementRef) {
  if (typeof document === "undefined") return;
  let styleElement = styleElementRef.current;
  if (!styleElement || !styleElement.isConnected) {
    styleElement = document.getElementById(FOLDER_STYLES_ELEMENT_ID);
    if (!(styleElement instanceof HTMLStyleElement)) {
      styleElement = document.createElement("style");
      styleElement.id = FOLDER_STYLES_ELEMENT_ID;
      styleElement.dataset.source = "workspace-folder-json";
      document.head.appendChild(styleElement);
    }
    styleElementRef.current = styleElement;
  }
  styleElement.textContent = stylesheetText;
}

export function parseStylesheetPathFromFolderConfig(rawFolderConfig) {
  if (typeof rawFolderConfig !== "string" || !rawFolderConfig.trim()) return "";

  try {
    const repairedConfig = jsonrepair(rawFolderConfig);
    const parsedConfig = JSON.parse(repairedConfig);
    return trimString(parsedConfig?.styles);
  } catch {
    return "";
  }
}

export function resolveFolderConfigRoot(activeTab, activePaneState) {
  const workspaceRoot = trimString(activeTab?.workspaceRoot);
  if (workspaceRoot) return workspaceRoot;

  if (activePaneState?.panelType !== "Filesystem") return "";
  return trimString(activePaneState?.filesystemState?.currentPath);
}

export default function useWorkspaceFolderStyles({ activeTab, activePaneState }) {
  const styleElementRef = useRef(null);
  const requestIdRef = useRef(0);
  const configRoot = useMemo(
    () => resolveFolderConfigRoot(activeTab, activePaneState),
    [
      activePaneState?.filesystemState?.currentPath,
      activePaneState?.panelType,
      activeTab?.workspaceRoot,
    ],
  );

  useEffect(() => {
    const nextRequestId = requestIdRef.current + 1;
    requestIdRef.current = nextRequestId;

    if (!configRoot) {
      clearInjectedStyles(styleElementRef);
      return undefined;
    }

    let isDisposed = false;

    async function loadFolderStylesheet() {
      try {
        const rawFolderConfig = await invoke("workspace_read_folder_config", {
          workspaceRoot: configRoot,
        });
        if (isDisposed || requestIdRef.current !== nextRequestId) return;

        const stylesheetPath = parseStylesheetPathFromFolderConfig(rawFolderConfig);
        if (!stylesheetPath) {
          clearInjectedStyles(styleElementRef);
          return;
        }

        const stylesheetContent = await invoke("workspace_read_folder_stylesheet", {
          workspaceRoot: configRoot,
          stylesheetPath,
        });
        if (isDisposed || requestIdRef.current !== nextRequestId) return;

        if (typeof stylesheetContent !== "string") {
          clearInjectedStyles(styleElementRef);
          return;
        }

        const rewrittenStylesheet = rewriteStylesheetUrlsForWorkspace(
          stylesheetContent,
          configRoot,
        );
        injectStyles(rewrittenStylesheet, styleElementRef);
      } catch {
        if (isDisposed || requestIdRef.current !== nextRequestId) return;
        clearInjectedStyles(styleElementRef);
      }
    }

    loadFolderStylesheet();

    return () => {
      isDisposed = true;
    };
  }, [configRoot]);

  useEffect(() => () => {
    clearInjectedStyles(styleElementRef);
  }, []);
}
