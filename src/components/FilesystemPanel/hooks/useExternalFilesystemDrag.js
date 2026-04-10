import { invoke } from "@tauri-apps/api/core";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { uniqueNonEmptyPaths } from "../../../utils/pathSelection";

const DRAG_OUT_POLL_INTERVAL_MS = 80;
const DRAG_OUT_WINDOW_PADDING_PX = 2;
const DRAG_OUT_GRACE_PERIOD_MS = 180;

function isCursorOutsideWindow(cursor, windowPosition, windowSize) {
  if (!cursor || !windowPosition || !windowSize) return false;

  const left = windowPosition.x + DRAG_OUT_WINDOW_PADDING_PX;
  const top = windowPosition.y + DRAG_OUT_WINDOW_PADDING_PX;
  const right = windowPosition.x + windowSize.width - DRAG_OUT_WINDOW_PADDING_PX;
  const bottom = windowPosition.y + windowSize.height - DRAG_OUT_WINDOW_PADDING_PX;

  return cursor.x < left || cursor.x > right || cursor.y < top || cursor.y > bottom;
}

function useExternalFilesystemDrag({
  dragPaths = [],
  isEnabled = false,
  onExternalDragStart = undefined,
  onExternalDragError = undefined,
}) {
  useEffect(() => {
    const normalizedPaths = uniqueNonEmptyPaths(dragPaths);
    if (!isEnabled || normalizedPaths.length === 0) return undefined;

    const appWindow = getCurrentWindow();
    let isDisposed = false;
    let isPolling = false;
    let didStartExternalDrag = false;
    let outsideSinceMs = null;

    async function startExternalDrag() {
      if (didStartExternalDrag) return;

      didStartExternalDrag = true;
      onExternalDragStart?.(normalizedPaths);

      try {
        await invoke("start_external_drag", {
          paths: normalizedPaths,
          mode: "copy",
        });
      } catch (dragError) {
        didStartExternalDrag = false;
        onExternalDragError?.(dragError);
      }
    }

    async function pollCursor() {
      if (isDisposed || didStartExternalDrag || isPolling) return;
      isPolling = true;

      try {
        const [cursor, windowPosition, windowSize] = await Promise.all([
          cursorPosition(),
          appWindow.innerPosition(),
          appWindow.innerSize(),
        ]);

        const isOutsideWindow = isCursorOutsideWindow(cursor, windowPosition, windowSize);
        if (isOutsideWindow) {
          if (outsideSinceMs === null) outsideSinceMs = Date.now();
        } else {
          outsideSinceMs = null;
        }

        if (
          isOutsideWindow
          && outsideSinceMs !== null
          && Date.now() - outsideSinceMs >= DRAG_OUT_GRACE_PERIOD_MS
        ) {
          await startExternalDrag();
        }
      } catch {
        // Best effort.
      } finally {
        isPolling = false;
      }
    }

    const intervalId = setInterval(() => {
      pollCursor();
    }, DRAG_OUT_POLL_INTERVAL_MS);

    return () => {
      isDisposed = true;
      clearInterval(intervalId);
    };
  }, [dragPaths, isEnabled, onExternalDragError, onExternalDragStart]);
}

export default useExternalFilesystemDrag;
