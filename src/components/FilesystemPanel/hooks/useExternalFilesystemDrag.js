import { invoke } from "@tauri-apps/api/core";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { uniqueNonEmptyPaths } from "../../../utils/pathSelection";

const DRAG_OUT_POLL_INTERVAL_MS = 80;
const DRAG_OUT_WINDOW_PADDING_PX = 2;

function isCursorOutsideWindow(cursor, windowPosition, windowSize) {
  if (!cursor || !windowPosition || !windowSize) {
    return false;
  }

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
  const isEnabledRef = useRef(isEnabled);
  const onExternalDragStartRef = useRef(onExternalDragStart);
  const onExternalDragErrorRef = useRef(onExternalDragError);

  isEnabledRef.current = isEnabled;
  onExternalDragStartRef.current = onExternalDragStart;
  onExternalDragErrorRef.current = onExternalDragError;

  useEffect(() => {
    const normalizedPaths = uniqueNonEmptyPaths(dragPaths);
    if (!isEnabled || normalizedPaths.length === 0) {
      return undefined;
    }

    const appWindow = getCurrentWindow();
    let pollTimeoutId = null;
    let isDisposed = false;
    let isCheckingCursor = false;
    let didStartExternalDrag = false;

    async function startExternalDrag() {
      if (!isEnabledRef.current || didStartExternalDrag) {
        return;
      }

      didStartExternalDrag = true;
      onExternalDragStartRef.current?.();

      try {
        await invoke("start_external_drag", { paths: normalizedPaths });
      } catch (dragError) {
        didStartExternalDrag = false;
        onExternalDragErrorRef.current?.(dragError);
      }
    }

    function scheduleCursorCheck() {
      if (isDisposed || didStartExternalDrag) {
        return;
      }

      pollTimeoutId = setTimeout(async () => {
        if (isDisposed || didStartExternalDrag || isCheckingCursor || !isEnabledRef.current) {
          scheduleCursorCheck();
          return;
        }

        isCheckingCursor = true;
        try {
          const [cursor, windowPosition, windowSize] = await Promise.all([
            cursorPosition(),
            appWindow.innerPosition(),
            appWindow.innerSize(),
          ]);

          if (isCursorOutsideWindow(cursor, windowPosition, windowSize)) {
            await startExternalDrag();
          }
        } catch {
          // Best effort; keep polling.
        } finally {
          isCheckingCursor = false;
        }

        scheduleCursorCheck();
      }, DRAG_OUT_POLL_INTERVAL_MS);
    }

    const handleWindowMouseOut = async (event) => {
      if (!isEnabledRef.current || didStartExternalDrag || event.relatedTarget) {
        return;
      }

      await startExternalDrag();
    };

    scheduleCursorCheck();
    document.addEventListener("mouseout", handleWindowMouseOut);
    return () => {
      isDisposed = true;
      if (pollTimeoutId) {
        clearTimeout(pollTimeoutId);
      }
      document.removeEventListener("mouseout", handleWindowMouseOut);
    };
  }, [dragPaths, isEnabled]);
}

export default useExternalFilesystemDrag;
