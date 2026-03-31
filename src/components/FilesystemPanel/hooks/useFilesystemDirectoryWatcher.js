import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

const FILESYSTEM_WATCH_EVENT = "filesystem-watch-event";
const WATCH_REFRESH_DEBOUNCE_MS = 120;

let filesystemWatchCounter = 0;

function createFilesystemWatchId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return `filesystem-watch-${crypto.randomUUID()}`;

  filesystemWatchCounter += 1;
  const randomToken = Math.random().toString(36).slice(2, 10);
  return `filesystem-watch-${Date.now()}-${filesystemWatchCounter}-${randomToken}`;
}

export default function useFilesystemDirectoryWatcher({
  currentPath = "",
  watchPaths = undefined,
  onDirectoryChange = undefined,
  onWatcherError = undefined,
}) {
  const watchRefreshTimeoutsRef = useRef(new Map());

  const normalizedWatchPaths = Array.isArray(watchPaths)
    ? watchPaths
    : (currentPath ? [currentPath] : []);
  const deduplicatedWatchPaths = [...new Set(
    normalizedWatchPaths
      .filter(path => typeof path === "string")
      .map(path => path.trim())
      .filter(Boolean),
  )];
  const watchPathKey = deduplicatedWatchPaths.join("\n");

  useEffect(() => {
    const watchedPaths = watchPathKey ? watchPathKey.split("\n") : [];
    if (watchedPaths.length === 0) return undefined;

    let isDisposed = false;
    let unlistenWatch = null;
    const watchIdToPath = new Map();

    const scheduleRefresh = (watchId, watchedPath, changedPath) => {
      if (!watchId || !watchedPath) return;
      if (watchRefreshTimeoutsRef.current.has(watchId)) return;

      const timeoutHandle = setTimeout(() => {
        watchRefreshTimeoutsRef.current.delete(watchId);
        Promise.resolve(onDirectoryChange?.(watchedPath, changedPath)).catch(refreshError => {
          if (!isDisposed && typeof onWatcherError === "function")
            onWatcherError(refreshError, watchedPath);
        });
      }, WATCH_REFRESH_DEBOUNCE_MS);
      watchRefreshTimeoutsRef.current.set(watchId, timeoutHandle);
    };

    const clearAllRefreshTimeouts = () => {
      for (const timeoutHandle of watchRefreshTimeoutsRef.current.values()) {
        clearTimeout(timeoutHandle);
      }
      watchRefreshTimeoutsRef.current.clear();
    };

    const initializeWatcher = async () => {
      for (const watchedPath of watchedPaths) {
        const watchId = createFilesystemWatchId();
        watchIdToPath.set(watchId, watchedPath);
        await invoke("filesystem_watch_start", { watchId, path: watchedPath });
      }

      unlistenWatch = await listen(FILESYSTEM_WATCH_EVENT, event => {
        const watchId = event.payload?.watchId;
        const watchedPath = watchIdToPath.get(watchId);
        if (!watchedPath) return;

        const changedPath = typeof event.payload?.changedPath === "string"
          ? event.payload.changedPath
          : "";
        scheduleRefresh(watchId, watchedPath, changedPath);
      });

      if (isDisposed) {
        if (typeof unlistenWatch === "function") unlistenWatch();
        clearAllRefreshTimeouts();
        await Promise.all(
          [...watchIdToPath.keys()].map((watchId) => (
            invoke("filesystem_watch_stop", { watchId }).catch(() => { })
          )),
        );
      }
    };

    initializeWatcher().catch((watchError) => {
      if (!isDisposed && typeof onWatcherError === "function")
        onWatcherError(watchError, watchedPaths[0]);
    });

    return () => {
      isDisposed = true;
      clearAllRefreshTimeouts();

      if (typeof unlistenWatch === "function") unlistenWatch();
      watchIdToPath.forEach((_watchedPath, watchId) => {
        invoke("filesystem_watch_stop", { watchId }).catch(() => { });
      });
    };
  }, [watchPathKey, onDirectoryChange, onWatcherError]);
}
