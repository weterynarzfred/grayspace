import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  listenWorkspaceUpdated,
  workspaceBootstrap,
  workspaceSetWindowBounds,
} from "./workspaceApi";
import { getErrorMessage } from "./appRuntime";

export default function useWorkspaceLifecycle({
  dispatch,
  setRuntimeError,
  currentWindowIdRef,
}) {
  useEffect(() => {
    let isDisposed = false;
    const unlistenCallbacks = [];

    const syncBounds = async (appWindow, windowId) => {
      if (!windowId) return;
      const [position, size] = await Promise.all([
        appWindow.outerPosition(),
        appWindow.outerSize(),
      ]);
      await workspaceSetWindowBounds(windowId, {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      });
    };

    const initializeWorkspace = async () => {
      const appWindow = getCurrentWindow();
      const bootstrap = await workspaceBootstrap(appWindow.label);
      if (isDisposed) return;

      dispatch({ type: "workspace/bootstrap", payload: bootstrap });
      await syncBounds(appWindow, bootstrap.windowId);

      const syncCurrentWindowBounds = () => {
        syncBounds(appWindow, currentWindowIdRef.current).catch(() => {});
      };

      unlistenCallbacks.push(await appWindow.onMoved(syncCurrentWindowBounds));
      unlistenCallbacks.push(await appWindow.onResized(syncCurrentWindowBounds));
      unlistenCallbacks.push(await listenWorkspaceUpdated(snapshot => {
        if (snapshot) dispatch({
          type: "workspace/snapshot",
          payload: { snapshot },
        });
      }));
    };

    initializeWorkspace().catch(error => {
      if (!isDisposed) setRuntimeError(getErrorMessage(error));
    });

    return () => {
      isDisposed = true;
      unlistenCallbacks.forEach(unlisten => unlisten?.());
    };
  }, [currentWindowIdRef, dispatch, setRuntimeError]);
}
