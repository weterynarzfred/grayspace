import { useMemo, useReducer, useRef, useState } from "react";
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
  initialWorkspaceViewState,
  selectActiveTab,
  selectCurrentWindow,
  selectTabsForWindow,
  workspaceReducer,
} from "./workspace/workspaceStore";
import useTabDragDrop from "./workspace/useTabDragDrop";
import useWorkspaceLifecycle from "./workspace/useWorkspaceLifecycle";
import useWorkspaceActions from "./workspace/useWorkspaceActions";
import usePaneSplitShortcuts from "./workspace/usePaneSplitShortcuts";
import { useNotificationCenter } from "./notifications/notificationCenter";

import styles from "./App.module.scss";

function App() {
  const [viewState, dispatch] = useReducer(workspaceReducer, initialWorkspaceViewState);
  const [runtimeError, setRuntimeError] = useState("");
  const currentWindowIdRef = useRef("");
  const {
    notifications,
    isNotificationsOpen,
    pushNotification,
    openConfirm,
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

  const workspaceActions = useWorkspaceActions({
    currentWindow,
    activeTab,
    pushNotification,
    openConfirm,
    setRuntimeError,
  });

  const {
    activeDragTabId,
    handleTabDragStart,
    handleTabDragMove,
    handleTabDrop,
    handleTabDragCancel,
  } = useTabDragDrop({
    snapshot: viewState.snapshot,
    currentWindow,
    onError: workspaceActions.handleWorkspaceCommandError,
  });

  usePaneSplitShortcuts(workspaceActions.handleSplitActivePane);

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
            onActivateTab={workspaceActions.handleSetActiveTab}
            onCloseTab={workspaceActions.handleCloseTab}
            onCreateTab={workspaceActions.handleCreateTab}
            onCreateWindow={workspaceActions.handleCreateWindow}
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
              onCurrentPathChange={workspaceActions.handleSetTabCwdHint}
              onFilesystemStateChange={workspaceActions.handleSetPaneFilesystemState}
              onTabSelectedFilesChange={workspaceActions.handleSetTabSelectedFiles}
              onPanelTypeChange={workspaceActions.handleChangePanelType}
              onPaneActivate={workspaceActions.handleSetActivePane}
              onPaneSplit={workspaceActions.handleSplitPane}
              onPaneClose={workspaceActions.handleClosePane}
              onPaneDirtyStateChange={workspaceActions.handlePaneDirtyStateChange}
              onSplitRatioChange={workspaceActions.handleSetSplitRatio}
            />
          </PanelsDndLayer>
        </section>
      </section>
    </main>
  );
}

export default App;
