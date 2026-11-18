import { useEffect } from "react";

function noop() { }
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  listenWorkspaceUpdated,
  workspaceBootstrap,
  workspaceSetWindowBounds,
} from "./workspaceApi";
import { getErrorMessage } from "./appRuntime";

// Moves and resizes fire per pixel; each report rebroadcasts the snapshot and may write the saved bounds.
export const BOUNDS_SYNC_DELAY_MS = 250;

export default function useWorkspaceLifecycle({
  dispatch,
  currentWindowIdRef,
}) {
  useEffect(() => {
    let isDisposed = false;
    let boundsSyncTimer = null;
    const unlistenCallbacks = [];

    // Inner size, because that is what Rust applies with set_size when it builds the window next launch.
    const syncBounds = async (appWindow, windowId) => {
      if (!windowId) return;
      const [position, size, maximized, minimized] = await Promise.all([
        appWindow.outerPosition(),
        appWindow.innerSize(),
        appWindow.isMaximized(),
        appWindow.isMinimized(),
      ]);
      // Minimized windows report -32000,-32000 on Windows, so Rust only records the flag for them.
      await workspaceSetWindowBounds(windowId, {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized,
      }, minimized);
    };

    const initializeWorkspace = async () => {
      const appWindow = getCurrentWindow();
      const bootstrap = await workspaceBootstrap(appWindow.label);
      if (isDisposed) return;

      dispatch({ type: "workspace/bootstrap", payload: bootstrap });
      await syncBounds(appWindow, bootstrap.windowId);

      const syncCurrentWindowBounds = () => {
        clearTimeout(boundsSyncTimer);
        boundsSyncTimer = setTimeout(() => {
          syncBounds(appWindow, currentWindowIdRef.current).catch(noop);
        }, BOUNDS_SYNC_DELAY_MS);
      };

      unlistenCallbacks.push(
        await appWindow.onMoved(syncCurrentWindowBounds),
        await appWindow.onResized(syncCurrentWindowBounds),
        await listenWorkspaceUpdated(snapshot => {
          if (snapshot) dispatch({
            type: "workspace/snapshot",
            payload: { snapshot },
          });
        })
      );
    };

    initializeWorkspace().catch(error => {
      if (isDisposed) return;
      console.error("[workspace-lifecycle]", getErrorMessage(error));
    });

    return () => {
      isDisposed = true;
      clearTimeout(boundsSyncTimer);
      unlistenCallbacks.forEach(unlisten => unlisten?.());
    };
  }, [currentWindowIdRef, dispatch]);
}
