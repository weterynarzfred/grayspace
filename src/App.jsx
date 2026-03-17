import { useCallback, useMemo, useReducer, useRef, useState } from "react";
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
  workspaceNewTab,
  workspaceNewWindow,
  workspaceSetActiveTab,
  workspaceSetTabPaneFilesystemState,
  workspaceSetTabPanelType,
  workspaceSetTabTerminalCwd,
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

import styles from "./App.module.scss";

function App() {
  const [viewState, dispatch] = useReducer(workspaceReducer, initialWorkspaceViewState);
  const [runtimeError, setRuntimeError] = useState("");
  const currentWindowIdRef = useRef("");
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
    setRuntimeError(getErrorMessage(error));
  }, []);

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

  const handleCloseTab = useCallback(tabId => {
    if (!currentWindow) return;
    workspaceCloseTab(currentWindow.windowId, tabId).catch(handleWorkspaceCommandError);
  }, [currentWindow, handleWorkspaceCommandError]);

  const handleChangePanelType = useCallback((tabId, pane, panelType) => {
    if (!tabId) return;
    workspaceSetTabPanelType(tabId, pane, panelType).catch(handleWorkspaceCommandError);
  }, [handleWorkspaceCommandError]);

  const handleSetTabCwdHint = useCallback((tabId, _pane, path) => {
    if (!tabId) return;
    workspaceSetTabTerminalCwd(tabId, path ?? "").catch(handleWorkspaceCommandError);
  }, [handleWorkspaceCommandError]);

  const handleSetPaneFilesystemState = useCallback((tabId, pane, filesystemState) => {
    if (!tabId) return;
    workspaceSetTabPaneFilesystemState(tabId, pane, filesystemState).catch(
      handleWorkspaceCommandError,
    );
  }, [handleWorkspaceCommandError]);

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
              onPanelTypeChange={handleChangePanelType}
            />
          </PanelsDndLayer>
        </section>
      </section>
    </main>
  );
}

export default App;
