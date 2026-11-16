import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FILESYSTEM_THUMBNAIL_SIZE_STEPS,
  normalizeFilesystemViewStyle,
} from "../filesystemPaneState";

const DRIVES_VIEW_STYLE_KEY = "::drives::";
const DESCENDING_BY_DEFAULT_SORT_KEYS = new Set(["modified", "size"]);

function saveFolderViewStyle(path, style) {
  invoke("workspace_folder_view_styles_set", {
    path: path || DRIVES_VIEW_STYLE_KEY,
    style,
  }).catch(() => {});
}

// Owns view type, thumbnail size and sort. Changes are saved for the folder last passed to
// `loadViewStyleForPath`; the ref is updated eagerly so bursts of Ctrl+Wheel events build on
// each other instead of on a stale render.
export default function useFilesystemViewStyle({
  initialFilesystemState,
  tabId = "",
  paneId = "",
  tabWorkspaceRoot = "",
}) {
  const [viewStyle, setViewStyle] = useState(() => normalizeFilesystemViewStyle(initialFilesystemState));
  const viewStyleRef = useRef(viewStyle);
  const stylePathRef = useRef(initialFilesystemState.currentPath);
  const tabWorkspaceRootRef = useRef(tabWorkspaceRoot);
  tabWorkspaceRootRef.current = tabWorkspaceRoot;
  const skipNextPathLoadRef = useRef(tabWorkspaceRoot !== "");
  const pathLoadEpochRef = useRef(0);

  const applyViewStyle = useCallback((nextStyle) => {
    viewStyleRef.current = nextStyle;
    setViewStyle(nextStyle);
  }, []);

  const updateViewStyle = useCallback((patch) => {
    const nextStyle = { ...viewStyleRef.current, ...patch };
    applyViewStyle(nextStyle);
    saveFolderViewStyle(stylePathRef.current, nextStyle);
  }, [applyViewStyle]);

  useEffect(() => {
    skipNextPathLoadRef.current = tabWorkspaceRootRef.current !== "";
    pathLoadEpochRef.current += 1;
  }, [paneId, tabId]);

  // A workspace's first folder keeps the style restored from the workspace layout.
  const loadViewStyleForPath = useCallback((path) => {
    stylePathRef.current = path;
    if (path && skipNextPathLoadRef.current) {
      skipNextPathLoadRef.current = false;
      return;
    }
    const epoch = ++pathLoadEpochRef.current;
    invoke("workspace_folder_view_styles_get", { path: path || DRIVES_VIEW_STYLE_KEY }).then((style) => {
      if (pathLoadEpochRef.current !== epoch || !style) return;
      applyViewStyle(normalizeFilesystemViewStyle(style, viewStyleRef.current));
    }).catch(() => {});
  }, [applyViewStyle]);

  const stepThumbnailSize = useCallback((delta, { wrap = false } = {}) => {
    const steps = FILESYSTEM_THUMBNAIL_SIZE_STEPS;
    const currentIndex = Math.max(0, steps.indexOf(viewStyleRef.current.thumbnailSizePx));
    const nextIndex = wrap
      ? (currentIndex + delta + steps.length) % steps.length
      : Math.max(0, Math.min(steps.length - 1, currentIndex + delta));
    if (nextIndex === currentIndex) return;
    updateViewStyle({ thumbnailSizePx: steps[nextIndex] });
  }, [updateViewStyle]);

  const handleCtrlWheel = useCallback((event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    stepThumbnailSize(event.deltaY < 0 ? 1 : -1);
  }, [stepThumbnailSize]);

  // Same key again reverses the order; a new key starts newest/largest first for date and size.
  const sortBy = useCallback((sortKey) => {
    const current = viewStyleRef.current;
    updateViewStyle({
      sortKey,
      sortDescending: sortKey === current.sortKey
        ? !current.sortDescending
        : DESCENDING_BY_DEFAULT_SORT_KEYS.has(sortKey),
    });
  }, [updateViewStyle]);

  const toggleSortDirection = useCallback(() => {
    updateViewStyle({ sortDescending: !viewStyleRef.current.sortDescending });
  }, [updateViewStyle]);

  return {
    viewStyle,
    updateViewStyle,
    loadViewStyleForPath,
    stepThumbnailSize,
    handleCtrlWheel,
    sortBy,
    toggleSortDirection,
  };
}
