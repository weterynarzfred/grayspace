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
import SystemNotificationPopover from "./components/popovers/SystemNotificationPopover";
import {
  COMMAND_IDS,
  getCommandsForTrigger,
  isCommandShortcutMatch,
} from "./commands/commandRegistry";
import executeCommand from "./commands/executeCommand";
import { getSelectedPathsFromState } from "./utils/pathSelection";

import styles from "./App.module.scss";

function getActivePaneState(activeTab) {
  const activePaneId = activeTab?.activePaneId ?? "";
  return activeTab?.paneStates?.[activePaneId] ?? null;
}

function resolveContextMenuSelectedPaths(commandContext, target) {
  const activeSelection = getSelectedPathsFromState({ selectedPaths: commandContext.selectedPaths });
  if (!target) return activeSelection;

  const isFilesystemPanelTarget = target.kind === "panel" && target.panelType === "Filesystem";
  if (isFilesystemPanelTarget) return [];

  const isFilesystemEntryTarget =
    (target.kind === "file" || target.kind === "folder")
    && target.scope === "tree-entry";
  if (isFilesystemEntryTarget && target.path && !activeSelection.includes(target.path)) {
    return [target.path];
  }

  return activeSelection;
}

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
    context: null,
  });
  const currentWindowIdRef = useRef("");
  const lastPointerPositionRef = useRef({ x: 24, y: 24 });
  const {
    activeNotification,
    pushNotification,
    openConfirm,
    dismissNotification,
    closeNotificationWithDefault,
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
  const activePaneState = getActivePaneState(activeTab);
  const commandContextBase = useMemo(() => ({
    activePaneId: activeTab?.activePaneId ?? "",
    activePanelType: activePaneState?.panelType ?? "",
    isFilesystemBrowsing: Boolean(activePaneState?.filesystemState?.currentPath),
    selectedPaths: getSelectedPathsFromState(activePaneState?.filesystemState),
  }), [
    activePaneState?.filesystemState,
    activePaneState?.panelType,
    activeTab?.activePaneId,
  ]);
  const paletteContext = useMemo(
    () => ({ ...commandContextBase, source: "palette" }),
    [commandContextBase],
  );
  const paletteCommands = useMemo(
    () => getCommandsForTrigger("palette", paletteContext),
    [paletteContext],
  );
  const contextMenuCommands = useMemo(() => {
    if (!contextMenuState.context) return [];
    return getCommandsForTrigger("context-menu", contextMenuState.context);
  }, [contextMenuState.context]);

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

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteState((state) => state.isOpen ? { ...state, isOpen: false } : state);
  }, []);
  const closeContextMenu = useCallback(() => {
    setContextMenuState((state) => state.isOpen
      ? { ...state, isOpen: false, target: null, context: null }
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
  const handleContextMenu = useCallback((event) => {
    event.preventDefault();
    const target = resolveContextMenuTarget(event.target);
    if (!target) {
      closeContextMenu();
      return;
    }

    const contextMenuSelection = resolveContextMenuSelectedPaths(commandContextBase, target);
    const context = {
      ...commandContextBase,
      source: "context-menu",
      targetType: target.kind,
      targetId: target.id,
      targetLabel: target.label,
      targetPath: target.path,
      targetScope: target.scope,
      targetPaneId: target.paneId,
      targetPanelType: target.panelType,
      selectedPaths: contextMenuSelection,
    };
    setContextMenuState({
      isOpen: true,
      position: {
        x: event.clientX,
        y: event.clientY,
      },
      target,
      context,
    });
    closeCommandPalette();
  }, [closeCommandPalette, closeContextMenu, commandContextBase]);
  const executeAppCommand = useCallback((commandId, context = {}) => executeCommand(
    commandId,
    {
      context,
      activeTab,
      workspaceActions,
      openCommandPalette,
    },
  ), [activeTab, openCommandPalette, workspaceActions]);
  usePaneSplitShortcuts(executeAppCommand);
  const handleTabMiddleClick = useCallback((tabId) => {
    if (!tabId) return;
    executeAppCommand(COMMAND_IDS.TAB_CLOSE, {
      source: "shortcut",
      targetType: "tab",
      targetId: tabId,
    });
  }, [executeAppCommand]);
  const handleContextMenuCommand = useCallback((commandId) => {
    const context = contextMenuState.context;
    executeAppCommand(commandId, context ?? {});
    closeContextMenu();
  }, [closeContextMenu, contextMenuState.context, executeAppCommand]);
  const handlePaletteCommand = useCallback((commandId) => {
    closeCommandPalette();
    executeAppCommand(commandId, paletteContext);
  }, [closeCommandPalette, executeAppCommand, paletteContext]);
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented) return;
      if (!isCommandShortcutMatch(COMMAND_IDS.COMMAND_PALETTE_OPEN, event)) return;
      event.preventDefault();
      executeAppCommand(COMMAND_IDS.COMMAND_PALETTE_OPEN, { source: "shortcut" });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [executeAppCommand]);

  useEffect(() => {
    if (!activeNotification) return;
    closeContextMenu();
    closeCommandPalette();
  }, [activeNotification, closeCommandPalette, closeContextMenu]);

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
    onContextMenu={handleContextMenu}
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
          onMiddleClickTab={handleTabMiddleClick}
          onCreateTab={workspaceActions.handleCreateTab}
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
      commands={paletteCommands}
      onCommand={handlePaletteCommand}
      onClose={closeCommandPalette}
    />
    <ContextMenuPopover
      open={contextMenuState.isOpen}
      position={contextMenuState.position}
      target={contextMenuState.target}
      commands={contextMenuCommands}
      onCommand={handleContextMenuCommand}
      onClose={closeContextMenu}
    />
    <SystemNotificationPopover
      open={Boolean(activeNotification)}
      notification={activeNotification}
      onDismiss={dismissNotification}
      onResolveConfirm={resolveConfirmNotification}
      onCloseWithDefault={closeNotificationWithDefault}
    />
  </main>;
}

export default App;
