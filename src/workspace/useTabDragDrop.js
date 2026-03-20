import { useCallback, useRef, useState } from "react";
import { parseTabDndId, resolveTabDropAction } from "./dragCoordinator";
import {
  workspaceCloseWindow,
  workspaceDetachTabToNewWindow,
  workspaceMoveTab,
} from "./workspaceApi";
import { ensureWorkspaceWindowCreated, getScreenPointFromEvent } from "./appRuntime";

const EMPTY_DRAG_STATE = {
  tabId: "",
  pointerStart: null,
  pointerCurrent: null,
};

export default function useTabDragDrop({ snapshot, currentWindow, onError }) {
  const [activeDragTabId, setActiveDragTabId] = useState("");
  const tabDragRef = useRef(EMPTY_DRAG_STATE);

  const resetDragState = useCallback(() => {
    setActiveDragTabId("");
    tabDragRef.current = EMPTY_DRAG_STATE;
  }, []);

  const handleTabDragStart = useCallback(event => {
    const tabId = parseTabDndId(event.active?.id);
    const pointerStart = getScreenPointFromEvent(event.activatorEvent);
    if (!tabId || !pointerStart) return;

    tabDragRef.current = {
      tabId,
      pointerStart,
      pointerCurrent: pointerStart,
    };
    setActiveDragTabId(tabId);
  }, []);

  const handleTabDragMove = useCallback(event => {
    if (!tabDragRef.current.pointerStart) return;

    tabDragRef.current = {
      ...tabDragRef.current,
      pointerCurrent: {
        x: Math.round(tabDragRef.current.pointerStart.x + event.delta.x),
        y: Math.round(tabDragRef.current.pointerStart.y + event.delta.y),
      },
    };
  }, []);

  const closeWindowSilently = useCallback(async windowId => {
    if (!windowId) return;
    await workspaceCloseWindow(windowId).catch(() => { });
  }, []);

  const detachTabToNewWindow = useCallback(async (dropAction) => {
    const createdWindow = await workspaceDetachTabToNewWindow(
      dropAction.sourceWindowId,
      dropAction.tabId,
      dropAction.point?.x ?? null,
      dropAction.point?.y ?? null,
    );

    try {
      await ensureWorkspaceWindowCreated(createdWindow);
    } catch (error) {
      await closeWindowSilently(createdWindow?.windowId);
      throw error;
    }
  }, [closeWindowSilently]);

  const handleTabDrop = useCallback(async event => {
    if (!currentWindow || !snapshot) {
      resetDragState();
      return;
    }

    const draggedTabId = parseTabDndId(event.active?.id);
    if (!draggedTabId) {
      resetDragState();
      return;
    }

    const dropAction = resolveTabDropAction({
      snapshot,
      sourceWindowId: currentWindow.windowId,
      tabOrder: currentWindow.tabOrder,
      activeTabId: draggedTabId,
      overId: event.over?.id,
      pointer: tabDragRef.current.pointerCurrent,
    });

    try {
      if (dropAction.kind === "move") {
        await workspaceMoveTab(
          dropAction.sourceWindowId,
          dropAction.targetWindowId,
          dropAction.tabId,
          dropAction.targetIndex,
        );
      } else if (dropAction.kind === "detach") {
        await detachTabToNewWindow(dropAction);
      }
    } catch (error) {
      onError(error);
    } finally {
      resetDragState();
    }
  }, [currentWindow, detachTabToNewWindow, onError, resetDragState, snapshot]);

  const handleTabDragCancel = useCallback(() => {
    resetDragState();
  }, [resetDragState]);

  return {
    activeDragTabId,
    handleTabDragStart,
    handleTabDragMove,
    handleTabDrop,
    handleTabDragCancel,
  };
}
