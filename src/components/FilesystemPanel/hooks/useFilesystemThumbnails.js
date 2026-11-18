import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { uniqueNonEmptyPaths } from "../../../utils/pathSelection";

const THUMBNAIL_UPDATE_EVENT = "thumbnail:update";
const DEFAULT_THUMBNAIL_SIZE_HINT_PX = 22;
const THUMBNAIL_REQUEST_DEBOUNCE_MS = 40;

// The same split as ThumbnailBucket::from_size_hint in Rust, which picks the cached size.
function resolveThumbnailBucketPx(sizeHintPx) {
  if (sizeHintPx <= 64) return 64;
  return sizeHintPx <= 256 ? 256 : 512;
}

function getEntryFilePaths(entries = []) {
  return uniqueNonEmptyPaths(entries
    .filter((entry) => entry && !entry.is_dir)
    .map((entry) => entry.path));
}

function isThumbnailReadyResult(result) {
  return result?.status === "ready"
    && typeof result?.sourcePath === "string"
    && result?.sourcePath
    && typeof result?.thumbnailPath === "string"
    && result?.thumbnailPath;
}

function makeThumbnailUpdater(results, trackedPathSet) {
  return (previousMap) => applyThumbnailResults(previousMap, results, trackedPathSet);
}

function applyThumbnailResults(previousMap, results, trackedPathSet) {
  let hasChanged = false;
  const nextMap = { ...previousMap };

  results.forEach((result) => {
    const sourcePath = typeof result?.sourcePath === "string" ? result.sourcePath : "";
    if (!sourcePath || !trackedPathSet.has(sourcePath)) return;

    if (isThumbnailReadyResult(result)) {
      const nextSrc = convertFileSrc(result.thumbnailPath);
      if (nextMap[sourcePath] !== nextSrc) {
        nextMap[sourcePath] = nextSrc;
        hasChanged = true;
      }
      return;
    }

    if (
      result?.status === "unsupported"
      || result?.status === "error"
    ) {
      if (sourcePath in nextMap) {
        delete nextMap[sourcePath];
        hasChanged = true;
      }
    }
  });

  return hasChanged ? nextMap : previousMap;
}

export default function useFilesystemThumbnails({
  currentPath = "",
  visibleEntries = [],
  thumbnailSizePx = DEFAULT_THUMBNAIL_SIZE_HINT_PX,
}) {
  const [thumbnailSrcByPath, setThumbnailSrcByPath] = useState({});
  const latestPathRef = useRef(currentPath);
  const trackedPathSetRef = useRef(new Set());
  const thumbnailBucketPx = useMemo(
    () => resolveThumbnailBucketPx(thumbnailSizePx),
    [thumbnailSizePx],
  );
  const visibleFilePaths = useMemo(() => getEntryFilePaths(visibleEntries), [visibleEntries]);

  useEffect(() => {
    latestPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    const trackedPathSet = new Set(visibleFilePaths);
    trackedPathSetRef.current = trackedPathSet;
    setThumbnailSrcByPath((previousMap) => {
      const previousPaths = Object.keys(previousMap);
      if (previousPaths.length === 0) return previousMap;

      let hasChanged = false;
      const nextMap = {};
      previousPaths.forEach((path) => {
        if (!trackedPathSet.has(path)) {
          hasChanged = true;
          return;
        }
        nextMap[path] = previousMap[path];
      });

      return hasChanged ? nextMap : previousMap;
    });
  }, [visibleFilePaths]);

  useEffect(() => {
    setThumbnailSrcByPath({});
  }, [currentPath, thumbnailBucketPx]);

  useEffect(() => {
    let unsubscribe = null;
    let cancelled = false;

    async function subscribe() {
      const unlisten = await listen(THUMBNAIL_UPDATE_EVENT, (event) => {
        const payload = event?.payload;
        if (payload?.bucketPx !== thumbnailBucketPx) return;
        const trackedPathSet = trackedPathSetRef.current;
        setThumbnailSrcByPath(makeThumbnailUpdater([payload], trackedPathSet));
      });
      if (cancelled) {
        unlisten();
        return;
      }
      unsubscribe = unlisten;
    }

    subscribe();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [thumbnailBucketPx]);

  useEffect(() => {
    if (!currentPath || visibleFilePaths.length === 0) return;

    const request = {
      items: visibleFilePaths.map((sourcePath) => ({
        sourcePath,
        // The cached size, not the drawn one: grid previews change size with the pane's width.
        sizeHintPx: thumbnailBucketPx,
        priority: "visible",
      })),
    };
    let cancelled = false;

    let timeoutId = null;
    async function resolveVisibleThumbnails() {
      try {
        const response = await invoke("thumbnail_resolve_batch", { request });
        if (cancelled || latestPathRef.current !== currentPath) return;
        const results = Array.isArray(response?.results) ? response.results : [];
        const trackedPathSet = trackedPathSetRef.current;
        setThumbnailSrcByPath((previousMap) => applyThumbnailResults(previousMap, results, trackedPathSet));
      } catch {
        // Fail silently: placeholders stay visible when thumbnail generation fails.
      }
    }

    timeoutId = setTimeout(resolveVisibleThumbnails, THUMBNAIL_REQUEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
    };
  }, [currentPath, thumbnailBucketPx, visibleFilePaths]);

  return {
    thumbnailSrcByPath,
  };
}
