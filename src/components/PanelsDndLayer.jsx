import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { EXTERNAL_FILESYSTEM_DRAG_START_EVENT } from "./dndExternalEvents";

const PanelsDndHandlersContext = createContext(null);

function callHandlers(handlerEntries, callbackName, event) {
  handlerEntries.forEach(handlers => {
    const callback = handlers[callbackName];
    if (typeof callback === "function") callback(event);
  });
}

function dispatchSyntheticPointerRelease() {
  if (typeof document === "undefined") return;

  try {
    document.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      buttons: 0,
    }));
  } catch {
    // PointerEvent may be unavailable in some environments.
  }

  try {
    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 0,
    }));
  } catch {
    // Best effort fallback for environments without PointerEvent support.
  }
}

function PanelsDndLayer({ children }) {
  const handlerEntriesRef = useRef(new Set());
  const [isDragActive, setIsDragActive] = useState(false);
  const isDragActiveRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  const registerHandlers = useCallback(handlers => {
    handlerEntriesRef.current.add(handlers);
    return () => { handlerEntriesRef.current.delete(handlers); };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleExternalDragStart = () => {
      if (!isDragActiveRef.current) return;
      isDragActiveRef.current = false;
      setIsDragActive(false);
      callHandlers(handlerEntriesRef.current, "onDragCancel");
      dispatchSyntheticPointerRelease();
    };

    window.addEventListener(EXTERNAL_FILESYSTEM_DRAG_START_EVENT, handleExternalDragStart);
    return () => {
      window.removeEventListener(EXTERNAL_FILESYSTEM_DRAG_START_EVENT, handleExternalDragStart);
    };
  }, []);

  const contextValue = useMemo(() => ({
    registerHandlers,
    isDragActive,
  }), [isDragActive, registerHandlers]);

  function handleDragStart(event) {
    isDragActiveRef.current = true;
    setIsDragActive(true);
    callHandlers(handlerEntriesRef.current, "onDragStart", event);
  }

  function handleDragOver(event) {
    if (!isDragActiveRef.current) return;
    callHandlers(handlerEntriesRef.current, "onDragOver", event);
  }

  function handleDragEnd(event) {
    const wasDragActive = isDragActiveRef.current;
    isDragActiveRef.current = false;
    setIsDragActive(false);
    if (!wasDragActive) return;
    callHandlers(handlerEntriesRef.current, "onDragEnd", event);
  }

  function handleDragCancel(event) {
    const wasDragActive = isDragActiveRef.current;
    isDragActiveRef.current = false;
    setIsDragActive(false);
    if (!wasDragActive) return;
    callHandlers(handlerEntriesRef.current, "onDragCancel", event);
  }

  return <PanelsDndHandlersContext.Provider value={contextValue}>
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      autoScroll={false}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >{children}</DndContext>
  </PanelsDndHandlersContext.Provider>;
}

export function usePanelsDndHandlers(handlers) {
  const context = useContext(PanelsDndHandlersContext);
  const registerHandlers = context?.registerHandlers ?? null;
  const handlersRef = useRef(handlers);

  handlersRef.current = handlers;

  useEffect(() => {
    if (!registerHandlers) return undefined;

    return registerHandlers({
      onDragStart: event => handlersRef.current.onDragStart?.(event),
      onDragOver: event => handlersRef.current.onDragOver?.(event),
      onDragEnd: event => handlersRef.current.onDragEnd?.(event),
      onDragCancel: event => handlersRef.current.onDragCancel?.(event),
    });
  }, [registerHandlers]);
}

export function usePanelsDragActive() {
  const context = useContext(PanelsDndHandlersContext);
  return context?.isDragActive ?? false;
}

export default PanelsDndLayer;
