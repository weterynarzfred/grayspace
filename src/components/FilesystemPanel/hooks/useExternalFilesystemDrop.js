import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

function isInsidePanel(panelElement, physicalPosition) {
  if (!panelElement || !physicalPosition) {
    return false;
  }

  const ratio = window.devicePixelRatio || 1;
  const x = physicalPosition.x / ratio;
  const y = physicalPosition.y / ratio;
  const bounds = panelElement.getBoundingClientRect();

  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function useExternalFilesystemDrop({ panelRef, isEnabled, onDropPaths }) {
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const isEnabledRef = useRef(isEnabled);
  const onDropPathsRef = useRef(onDropPaths);

  isEnabledRef.current = isEnabled;
  onDropPathsRef.current = onDropPaths;

  useEffect(() => {
    let isDisposed = false;
    let unlistenFn = null;

    getCurrentWindow()
      .onDragDropEvent(async (event) => {
        const payload = event?.payload;

        if (!payload) {
          return;
        }

        if (payload.type === "leave") {
          setIsExternalDragOver(false);
          return;
        }

        const panelElement = panelRef.current;
        const isInside = isInsidePanel(panelElement, payload.position);
        const canDropInPanel = isEnabledRef.current && isInside;

        if (payload.type === "enter" || payload.type === "over") {
          setIsExternalDragOver(canDropInPanel);
          return;
        }

        if (payload.type !== "drop") {
          return;
        }

        setIsExternalDragOver(false);

        if (!canDropInPanel || !Array.isArray(payload.paths) || payload.paths.length === 0) {
          return;
        }

        try {
          await onDropPathsRef.current(payload.paths);
        } catch {
          // Caller handles user-facing errors.
        }
      })
      .then((unlisten) => {
        if (isDisposed) {
          unlisten();
          return;
        }

        unlistenFn = unlisten;
      });

    return () => {
      isDisposed = true;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [panelRef]);

  return { isExternalDragOver };
}

export default useExternalFilesystemDrop;
