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
  initialWorkspaceViewState,
  selectActiveTab,
  selectCurrentWindow,
  selectTabsForWindow,
  workspaceReducer,
} from "./workspace/workspaceStore";
import useTabDragDrop from "./workspace/useTabDragDrop";
import useWorkspaceLifecycle from "./workspace/useWorkspaceLifecycle";
import useWorkspaceActions from "./workspace/useWorkspaceActions";
import useWorkspaceTabTitles from "./workspace/useWorkspaceTabTitles";
import usePaneSplitShortcuts from "./workspace/usePaneSplitShortcuts";
import { useNotificationCenter } from "./notifications/notificationCenter";
import resolveContextMenuTarget from "./context/resolveContextMenuTarget";
import CommandPalettePopover from "./components/popovers/CommandPalettePopover";
import ContextMenuPopover from "./components/popovers/ContextMenuPopover";

import styles from "./App.module.scss";

function App() {
  const [viewState, dispatch] = useReducer(workspaceReducer, initialWorkspaceViewState);
  const [runtimeError, setRuntimeError] = useState("");
  const [commandPaletteState, setCommandPaletteState] = useState({
    isOpen: false,
    position: { x: 24, y: 24 },
  });
  const [contextMenuState, setContextMenuState] = useState({
    isOpen: false,
    position: { x: 24, y: 24 },
    target: null,
  });
  const currentWindowIdRef = useRef("");
  const lastPointerPositionRef = useRef({ x: 24, y: 24 });
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

  const currentWindow = selectCurrentWindow(viewState.snapshot, viewState.currentWindowId);
  const tabs = selectTabsForWindow(viewState.snapshot, currentWindow);
  const tabTitlesByTabId = useWorkspaceTabTitles(tabs);
  const titledTabs = useMemo(() => tabs.map((tab) => ({
    ...tab,
    title: tabTitlesByTabId[tab.tabId] ?? tab.title,
  })), [tabTitlesByTabId, tabs]);
  const activeTab = selectActiveTab(viewState.snapshot, currentWindow);

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
  const closeCommandPalette = useCallback(() => {
    setCommandPaletteState((state) => state.isOpen ? { ...state, isOpen: false } : state);
  }, []);
  const closeContextMenu = useCallback(() => {
    setContextMenuState((state) => state.isOpen
      ? { ...state, isOpen: false, target: null }
      : state);
  }, []);
  const openCommandPalette = useCallback(() => {
    const { x, y } = lastPointerPositionRef.current;
    setCommandPaletteState({
      isOpen: true,
      position: { x, y },
    });
    closeContextMenu();
  }, [closeContextMenu]);
  const handlePointerMoveCapture = useCallback((event) => {
    lastPointerPositionRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
  }, []);
  const handleContextMenuCapture = useCallback((event) => {
    event.preventDefault();
    const target = resolveContextMenuTarget(event.target);
    if (!target) {
      closeContextMenu();
      return;
    }

    setContextMenuState({
      isOpen: true,
      position: {
        x: event.clientX,
        y: event.clientY,
      },
      target,
    });
    closeCommandPalette();
  }, [closeCommandPalette, closeContextMenu]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented) return;
      if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;
      if (event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      openCommandPalette();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openCommandPalette]);

  if (!currentWindow || !activeTab) {
    return <main className={styles.appShell}>
      <div className={styles.loadingShell}>
        <p className={styles.loadingText}>Loading workspace...</p>
        {runtimeError ? <p className={styles.errorText}>{runtimeError}</p> : null}
      </div>
    </main>;
  }

  return <main
    className={styles.appShell}
    onPointerMoveCapture={handlePointerMoveCapture}
    onContextMenuCapture={handleContextMenuCapture}
  >
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
          tabs={titledTabs}
          activeTabId={currentWindow.activeTabId}
          activeDragTabId={activeDragTabId}
          onActivateTab={workspaceActions.handleSetActiveTab}
          onCloseTab={workspaceActions.handleCloseTab}
          onCreateTab={workspaceActions.handleCreateTab}
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
    <CommandPalettePopover
      open={commandPaletteState.isOpen}
      position={commandPaletteState.position}
      onClose={closeCommandPalette}
    />
    <ContextMenuPopover
      open={contextMenuState.isOpen}
      position={contextMenuState.position}
      target={contextMenuState.target}
      onClose={closeContextMenu}
    />
  </main>;
}

export default App;
