import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import {
  externalPathKey,
  extractExternalPathsFromDataTransfer,
  extractExternalPathsFromDataTransferItems,
  hasExternalPayload,
  uniqueExternalPaths,
} from "./externalPathDropParsing";

const DUPLICATE_DROP_WINDOW_MS = 120;

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
export {
  extractExternalPathsFromDataTransfer,
  extractExternalPathsFromDataTransferItems,
} from "./externalPathDropParsing";

function dropSignature(paths) {
  return paths
    .map(externalPathKey)
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
  const dragModifierStateRef = useRef({ ctrlKey: false, shiftKey: false });

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
      const normalizedPaths = uniqueExternalPaths(paths);
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

    const resolveTauriDropModifiers = async () => {
      try {
        const modifierState = await invoke("keyboard_modifier_state");
        const resolvedState = {
          ctrlKey: modifierState?.ctrlKey === true,
          shiftKey: modifierState?.shiftKey === true,
        };
        if (resolvedState.ctrlKey || resolvedState.shiftKey) return resolvedState;
        return dragModifierStateRef.current;
      } catch {
        return dragModifierStateRef.current;
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
      const { ctrlKey, shiftKey } = await resolveTauriDropModifiers();
      await triggerDrop(payload.paths ?? [], {
        source: "tauri",
        clientPosition,
        physicalPosition: payload.position ?? null,
        ctrlKey,
        shiftKey,
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

    subscribeTauriDragDrop();

    const updateKeyboardModifierState = (event) => {
      dragModifierStateRef.current = {
        ctrlKey: event.ctrlKey === true,
        shiftKey: event.shiftKey === true,
      };
    };
    const clearKeyboardModifierState = () => {
      dragModifierStateRef.current = { ctrlKey: false, shiftKey: false };
    };
    window.addEventListener("keydown", updateKeyboardModifierState, true);
    window.addEventListener("keyup", updateKeyboardModifierState, true);
    window.addEventListener("blur", clearKeyboardModifierState, true);

    const handleDocumentDragOver = (event) => {
      if (!hasExternalPayload(event.dataTransfer)) return;
      const clientPosition = { x: event.clientX, y: event.clientY };
      if (updateHoverState(clientPosition, "dom")) event.preventDefault();
    };

    const handleDocumentDrop = async (event) => {
      const ctrlKey = event.ctrlKey === true;
      const shiftKey = event.shiftKey === true;
      const clientPosition = { x: event.clientX, y: event.clientY };
      const isInside = isInsidePanelBounds(panelRef.current, clientPosition);
      if (isInside && isEnabledRef.current) event.preventDefault();

      const droppedPaths = uniqueExternalPaths([
        ...extractExternalPathsFromDataTransfer(event.dataTransfer),
        ...await extractExternalPathsFromDataTransferItems(event.dataTransfer),
      ]);

      clearHoverState("dom", "drop");
      if (!isInside || droppedPaths.length === 0) return;

      await triggerDrop(droppedPaths, {
        source: "dom",
        clientPosition,
        physicalPosition: null,
        dropEffect: typeof event.dataTransfer?.dropEffect === "string"
          ? event.dataTransfer.dropEffect
          : "",
        ctrlKey,
        shiftKey,
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
      window.removeEventListener("keydown", updateKeyboardModifierState, true);
      window.removeEventListener("keyup", updateKeyboardModifierState, true);
      window.removeEventListener("blur", clearKeyboardModifierState, true);
    };
  }, [panelRef]);

  return { isExternalDragOver };
}
