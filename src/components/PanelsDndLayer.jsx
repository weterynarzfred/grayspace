import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { createContext, useCallback, useContext, useEffect, useRef } from "react";

const PanelsDndHandlersContext = createContext(null);

function callHandlers(handlerEntries, callbackName, event) {
  handlerEntries.forEach(handlers => {
    const callback = handlers[callbackName];
    if (typeof callback === "function") callback(event);
  });
}

function PanelsDndLayer({ children }) {
  const handlerEntriesRef = useRef(new Set());
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  const registerHandlers = useCallback(handlers => {
    handlerEntriesRef.current.add(handlers);
    return () => { handlerEntriesRef.current.delete(handlers); };
  }, []);

  return <PanelsDndHandlersContext.Provider value={registerHandlers}>
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      autoScroll={false}
      onDragStart={event => callHandlers(handlerEntriesRef.current, "onDragStart", event)}
      onDragEnd={event => callHandlers(handlerEntriesRef.current, "onDragEnd", event)}
      onDragCancel={event => callHandlers(handlerEntriesRef.current, "onDragCancel", event)}
    >{children}</DndContext>
  </PanelsDndHandlersContext.Provider>;
}

export function usePanelsDndHandlers(handlers) {
  const registerHandlers = useContext(PanelsDndHandlersContext);
  const handlersRef = useRef(handlers);

  handlersRef.current = handlers;

  useEffect(() => {
    if (!registerHandlers) return undefined;

    return registerHandlers({
      onDragStart: event => handlersRef.current.onDragStart?.(event),
      onDragEnd: event => handlersRef.current.onDragEnd?.(event),
      onDragCancel: event => handlersRef.current.onDragCancel?.(event),
    });
  }, [registerHandlers]);
}

export default PanelsDndLayer;
