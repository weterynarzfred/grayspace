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
  const watchRefreshStateRef = useRef(new Map());
  const normalizedWatchPaths = (Array.isArray(watchPaths) ? watchPaths : [currentPath])
    .filter(path => typeof path === "string")
    .map(path => path.trim())
    .filter(Boolean);
  const watchPathKey = [...new Set(normalizedWatchPaths)].join("\n");

  useEffect(() => {
    const watchedPaths = watchPathKey ? watchPathKey.split("\n") : [];
    if (watchedPaths.length === 0) return undefined;

    let isDisposed = false;
    let unlistenWatch = null;
    const watchIdToPath = new Map();
    const stopWatch = watchId => invoke("filesystem_watch_stop", { watchId }).catch(() => {});
    const stopAllWatches = () => (
      Promise.all([...watchIdToPath.keys()].map(stopWatch))
    );
    const clearAllRefreshTimeouts = () => {
      watchRefreshStateRef.current.forEach(refreshState => {
        clearTimeout(refreshState.timeoutHandle);
      });
      watchRefreshStateRef.current.clear();
    };

    const scheduleRefresh = (watchId, watchedPath, changedPath) => {
      if (!watchId || !watchedPath) return;

      const existingRefresh = watchRefreshStateRef.current.get(watchId);
      if (existingRefresh) {
        if (existingRefresh.changedPath !== changedPath) existingRefresh.changedPath = "";
        return;
      }

      const timeoutHandle = setTimeout(() => {
        const refreshState = watchRefreshStateRef.current.get(watchId);
        watchRefreshStateRef.current.delete(watchId);
        Promise.resolve(onDirectoryChange?.(watchedPath, refreshState?.changedPath ?? "")).catch(refreshError => {
          if (!isDisposed && typeof onWatcherError === "function")
            onWatcherError(refreshError, watchedPath);
        });
      }, WATCH_REFRESH_DEBOUNCE_MS);
      watchRefreshStateRef.current.set(watchId, {
        timeoutHandle,
        changedPath,
      });
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
        unlistenWatch?.();
        clearAllRefreshTimeouts();
        await stopAllWatches();
      }
    };

    initializeWatcher().catch(watchError => {
      if (!isDisposed && onWatcherError) onWatcherError(watchError, watchedPaths[0]);
    });

    return () => {
      isDisposed = true;
      clearAllRefreshTimeouts();
      unlistenWatch?.();
      void stopAllWatches();
    };
  }, [watchPathKey, onDirectoryChange, onWatcherError]);
}
