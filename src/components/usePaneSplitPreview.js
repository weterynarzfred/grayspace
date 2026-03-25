import { useCallback, useRef, useState } from "react";
import { getSplitDirectionFromDelta } from "./workspacePanelLayoutUtils";

const SPLIT_HANDLE_DRAG_THRESHOLD_PX = 8;

export default function usePaneSplitPreview({ tabId = "", onPaneSplit = undefined }) {
  const cornerDragStateRef = useRef(null);
  const [splitPreview, setSplitPreview] = useState(null);

  const handleCornerHandlePointerDown = useCallback((event, paneId) => {
    if (!paneId || !tabId) return;

    const pointerId = typeof event.pointerId === "number" ? event.pointerId : 0;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(pointerId);
    cornerDragStateRef.current = {
      pointerId,
      paneId,
      startX: event.clientX,
      startY: event.clientY,
    };
    setSplitPreview(null);
  }, [tabId]);

  const handleCornerHandlePointerMove = useCallback((event) => {
    const dragState = cornerDragStateRef.current;
    if (!dragState) return;
    if (typeof event.pointerId === "number" && event.pointerId !== dragState.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    const dragDistance = Math.hypot(deltaX, deltaY);

    if (dragDistance < SPLIT_HANDLE_DRAG_THRESHOLD_PX) {
      setSplitPreview(previousPreview => (previousPreview ? null : previousPreview));
      return;
    }

    const direction = getSplitDirectionFromDelta(deltaX, deltaY);
    setSplitPreview(previousPreview => {
      if (
        previousPreview?.paneId === dragState.paneId
        && previousPreview?.direction === direction
      ) {
        return previousPreview;
      }
      return {
        paneId: dragState.paneId,
        direction,
      };
    });
  }, []);

  const handleCornerHandlePointerUp = useCallback((event) => {
    const dragState = cornerDragStateRef.current;
    if (!dragState || !tabId) return;

    const pointerId = typeof event.pointerId === "number"
      ? event.pointerId
      : dragState.pointerId;
    if (pointerId !== dragState.pointerId) return;

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    const dragDistance = Math.hypot(deltaX, deltaY);
    if (dragDistance >= SPLIT_HANDLE_DRAG_THRESHOLD_PX) {
      const direction = getSplitDirectionFromDelta(deltaX, deltaY);
      onPaneSplit?.(tabId, dragState.paneId, direction);
    }

    event.currentTarget.releasePointerCapture?.(pointerId);
    cornerDragStateRef.current = null;
    setSplitPreview(null);
  }, [onPaneSplit, tabId]);

  const handleCornerHandlePointerCancel = useCallback((event) => {
    const dragState = cornerDragStateRef.current;
    const pointerId = typeof event.pointerId === "number" ? event.pointerId : null;
    if (dragState && pointerId === dragState.pointerId) {
      event.currentTarget.releasePointerCapture?.(pointerId);
      cornerDragStateRef.current = null;
      setSplitPreview(null);
    }
  }, []);

  const handleCornerHandleLostPointerCapture = useCallback(() => {
    cornerDragStateRef.current = null;
    setSplitPreview(null);
  }, []);

  return {
    splitPreview,
    handleCornerHandlePointerDown,
    handleCornerHandlePointerMove,
    handleCornerHandlePointerUp,
    handleCornerHandlePointerCancel,
    handleCornerHandleLostPointerCapture,
  };
}
