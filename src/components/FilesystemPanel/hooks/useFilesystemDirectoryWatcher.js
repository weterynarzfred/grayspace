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
  onDirectoryChange = undefined,
  onWatcherError = undefined,
}) {
  const watchRefreshTimeoutRef = useRef(null);

  useEffect(() => {
    if (!currentPath) return undefined;

    const watchId = createFilesystemWatchId();

    let isDisposed = false;
    let unlistenWatch = null;

    const scheduleRefresh = () => {
      if (watchRefreshTimeoutRef.current) return;

      watchRefreshTimeoutRef.current = setTimeout(() => {
        watchRefreshTimeoutRef.current = null;
        Promise.resolve(onDirectoryChange?.(currentPath)).catch(refreshError => {
          if (!isDisposed && typeof onWatcherError === "function")
            onWatcherError(refreshError, currentPath);
        });
      }, WATCH_REFRESH_DEBOUNCE_MS);
    };

    const initializeWatcher = async () => {
      await invoke("filesystem_watch_start", { watchId, path: currentPath });
      unlistenWatch = await listen(FILESYSTEM_WATCH_EVENT, event => {
        if (event.payload?.watchId !== watchId) return;
        scheduleRefresh();
      });

      if (isDisposed) {
        if (typeof unlistenWatch === "function") unlistenWatch();
        await invoke("filesystem_watch_stop", { watchId }).catch(() => { });
      }
    };

    initializeWatcher().catch((watchError) => {
      if (!isDisposed && typeof onWatcherError === "function")
        onWatcherError(watchError, currentPath);
    });

    return () => {
      isDisposed = true;

      if (watchRefreshTimeoutRef.current) {
        clearTimeout(watchRefreshTimeoutRef.current);
        watchRefreshTimeoutRef.current = null;
      }

      if (typeof unlistenWatch === "function") unlistenWatch();
      invoke("filesystem_watch_stop", { watchId }).catch(() => { });
    };
  }, [currentPath, onDirectoryChange, onWatcherError]);
}
