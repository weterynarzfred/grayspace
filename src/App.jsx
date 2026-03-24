import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import PanelsDndLayer from "./components/PanelsDndLayer";
import WorkspacePanelLayout from "./components/WorkspacePanelLayout";
import WorkspaceTabStrip from "./components/WorkspaceTabStrip";
import {
  workspaceCloseTab,
  workspaceCloseTabPane,
  workspaceNewTab,
  workspaceNewWindow,
  workspaceSetActiveTab,
  workspaceSetTabActivePane,
  workspaceSetTabPaneFilesystemState,
  workspaceSetTabPanelType,
  workspaceSetTabSelectedFiles,
  workspaceSetTabTerminalCwd,
  workspaceSplitTabPane,
} from "./workspace/workspaceApi";
import {
  initialWorkspaceViewState,
  selectActiveTab,
  selectCurrentWindow,
  selectTabsForWindow,
  workspaceReducer,
} from "./workspace/workspaceStore";
import { ensureWorkspaceWindowCreated, getErrorMessage } from "./workspace/appRuntime";
import useTabDragDrop from "./workspace/useTabDragDrop";
import useWorkspaceLifecycle from "./workspace/useWorkspaceLifecycle";
import { useNotificationCenter } from "./notifications/notificationCenter";

import styles from "./App.module.scss";

function isEditableKeyboardTarget(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable
    || tagName === "input"
    || tagName === "textarea"
    || tagName === "select"
  );
}

function resolveTabPaneId(tab, preferredPaneId = "") {
  if (preferredPaneId && tab?.paneStates?.[preferredPaneId]) return preferredPaneId;
  if (tab?.activePaneId && tab?.paneStates?.[tab.activePaneId]) return tab.activePaneId;
  return Object.keys(tab?.paneStates ?? {})[0] ?? "";
}

function App() {
  const [viewState, dispatch] = useReducer(workspaceReducer, initialWorkspaceViewState);
  const [runtimeError, setRuntimeError] = useState("");
  const currentWindowIdRef = useRef("");
  const {
    notifications,
    isNotificationsOpen,
    pushNotification,
    toggleNotifications,
    dismissNotification,
    resolveConfirmNotification,
  } = useNotificationCenter();
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  currentWindowIdRef.current = viewState.currentWindowId;

  useWorkspaceLifecycle({ dispatch, setRuntimeError, currentWindowIdRef });

  const currentWindow = useMemo(
    () => selectCurrentWindow(viewState.snapshot, viewState.currentWindowId),
    [viewState.snapshot, viewState.currentWindowId],
  );
  const tabs = useMemo(
    () => selectTabsForWindow(viewState.snapshot, currentWindow),
    [viewState.snapshot, currentWindow],
  );
  const activeTab = useMemo(
    () => selectActiveTab(viewState.snapshot, currentWindow),
    [viewState.snapshot, currentWindow],
  );

  const handleWorkspaceCommandError = useCallback(error => {
    const message = getErrorMessage(error);
    setRuntimeError(message);
    pushNotification({
      title: "Action failed",
      message,
      tone: "error",
      autoOpen: true,
    });
  }, [pushNotification]);

  const handleTabScopedCommandError = useCallback(error => {
    if (getErrorMessage(error) === "Tab not found.") return;
    handleWorkspaceCommandError(error);
  }, [handleWorkspaceCommandError]);

  const handleSetActiveTab = useCallback(tabId => {
    if (!currentWindow) return;
    workspaceSetActiveTab(currentWindow.windowId, tabId).catch(handleWorkspaceCommandError);
  }, [currentWindow, handleWorkspaceCommandError]);

  const handleCreateTab = useCallback(() => {
    if (!currentWindow) return;
    workspaceNewTab(currentWindow.windowId).catch(handleWorkspaceCommandError);
  }, [currentWindow, handleWorkspaceCommandError]);

  const handleCreateWindow = useCallback(async () => {
    if (!currentWindow) return;
    try {
      const createdWindow = await workspaceNewWindow({
        x: currentWindow.bounds.x + 40,
        y: currentWindow.bounds.y + 40,
      });
      await ensureWorkspaceWindowCreated(createdWindow);
    } catch (error) {
      handleWorkspaceCommandError(error);
    }
  }, [currentWindow, handleWorkspaceCommandError]);

  const handleCloseTab = useCallback((tabId) => {
    if (!currentWindow) return;
    workspaceCloseTab(currentWindow.windowId, tabId).catch(handleWorkspaceCommandError);
  }, [currentWindow, handleWorkspaceCommandError]);

  const handleChangePanelType = useCallback((tabId, paneId, panelType) => {
    if (!tabId) return;
    workspaceSetTabPanelType(tabId, paneId, panelType).catch(handleTabScopedCommandError);
  }, [handleTabScopedCommandError]);

  const handleSetTabCwdHint = useCallback((tabId, _paneId, path) => {
    if (!tabId) return;
    workspaceSetTabTerminalCwd(tabId, path ?? "").catch(handleTabScopedCommandError);
  }, [handleTabScopedCommandError]);

  const handleSetPaneFilesystemState = useCallback((tabId, paneId, filesystemState) => {
    if (!tabId) return;
    workspaceSetTabPaneFilesystemState(tabId, paneId, filesystemState).catch(
      handleTabScopedCommandError,
    );
  }, [handleTabScopedCommandError]);

  const handleSetActivePane = useCallback((tabId, paneId) => {
    if (!tabId || !paneId) return;
    if (activeTab?.tabId === tabId && activeTab?.activePaneId === paneId) return;
    workspaceSetTabActivePane(tabId, paneId).catch(handleTabScopedCommandError);
  }, [activeTab?.activePaneId, activeTab?.tabId, handleTabScopedCommandError]);

  const handleSplitPane = useCallback((tabId, paneId, direction) => {
    if (!tabId || !paneId) return;
    workspaceSplitTabPane(tabId, paneId, direction).catch(handleTabScopedCommandError);
  }, [handleTabScopedCommandError]);

  const handleClosePane = useCallback((tabId, paneId) => {
    if (!tabId || !paneId) return;
    workspaceCloseTabPane(tabId, paneId).catch(handleTabScopedCommandError);
  }, [handleTabScopedCommandError]);

  const handleSetTabSelectedFiles = useCallback((tabId, selectedFiles) => {
    if (!tabId) return;
    workspaceSetTabSelectedFiles(tabId, selectedFiles).catch(handleTabScopedCommandError);
  }, [handleTabScopedCommandError]);

  const {
    activeDragTabId,
    handleTabDragStart,
    handleTabDragMove,
    handleTabDrop,
    handleTabDragCancel,
  } = useTabDragDrop({
    snapshot: viewState.snapshot,
    currentWindow,
    onError: handleWorkspaceCommandError,
  });

  const handleSplitActivePane = useCallback((direction) => {
    if (!activeTab?.tabId) return;
    const paneId = resolveTabPaneId(activeTab);
    if (!paneId) return;
    handleSplitPane(activeTab.tabId, paneId, direction);
  }, [activeTab, handleSplitPane]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented || event.repeat) return;
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (isEditableKeyboardTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "v") {
        event.preventDefault();
        handleSplitActivePane("right");
      } else if (key === "h") {
        event.preventDefault();
        handleSplitActivePane("bottom");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleSplitActivePane]);

  if (!currentWindow || !activeTab) {
    return (
      <main className={styles.appShell}>
        <div className={styles.loadingShell}>
          <p className={styles.loadingText}>Loading workspace...</p>
          {runtimeError ? <p className={styles.errorText}>{runtimeError}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <main className={styles.appShell}>
      <section className={styles.workspaceShell}>
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          autoScroll={false}
          onDragStart={handleTabDragStart}
          onDragMove={handleTabDragMove}
          onDragEnd={handleTabDrop}
          onDragCancel={handleTabDragCancel}
        >
          <WorkspaceTabStrip
            tabs={tabs}
            activeTabId={currentWindow.activeTabId}
            activeDragTabId={activeDragTabId}
            onActivateTab={handleSetActiveTab}
            onCloseTab={handleCloseTab}
            onCreateTab={handleCreateTab}
            onCreateWindow={handleCreateWindow}
            notifications={notifications}
            isNotificationsOpen={isNotificationsOpen}
            onToggleNotifications={toggleNotifications}
            onDismissNotification={dismissNotification}
            onResolveNotificationConfirm={resolveConfirmNotification}
          />
        </DndContext>

        <section className={styles.workspaceContent}>
          {runtimeError ? <p className={styles.errorText}>{runtimeError}</p> : null}
          <PanelsDndLayer>
            <WorkspacePanelLayout
              tab={activeTab}
              cwdHint={activeTab.terminalCwdHint ?? ""}
              onCurrentPathChange={handleSetTabCwdHint}
              onFilesystemStateChange={handleSetPaneFilesystemState}
              onTabSelectedFilesChange={handleSetTabSelectedFiles}
              onPanelTypeChange={handleChangePanelType}
              onPaneActivate={handleSetActivePane}
              onPaneSplit={handleSplitPane}
              onPaneClose={handleClosePane}
            />
          </PanelsDndLayer>
        </section>
      </section>
    </main>
  );
}

export default App;
