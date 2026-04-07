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
import { getErrorMessage } from "./workspace/appRuntime";
import {
  workspaceRecentFoldersList,
  workspaceRecentFoldersRemove,
} from "./workspace/workspaceApi";
import { useNotificationCenter } from "./notifications/notificationCenter";
import resolveContextMenuTarget from "./context/resolveContextMenuTarget";
import CommandPalettePopover from "./components/popovers/CommandPalettePopover";
import ContextMenuPopover from "./components/popovers/ContextMenuPopover";
import RecentFoldersPopover from "./components/popovers/RecentFoldersPopover";
import SystemNotificationPopover from "./components/popovers/SystemNotificationPopover";
import {
  COMMAND_IDS,
  getCommandsForTrigger,
  isCommandShortcutMatch,
} from "./commands/commandRegistry";
import executeCommand from "./commands/executeCommand";
import { getSelectedPathsFromState } from "./utils/pathSelection";
import isEditableKeyboardTarget from "./utils/isEditableKeyboardTarget";

import styles from "./App.module.scss";

function getActivePaneState(activeTab) {
  const activePaneId = activeTab?.activePaneId ?? "";
  return activeTab?.paneStates?.[activePaneId] ?? null;
}

function arePathListsEqual(leftPaths = [], rightPaths = []) {
  if (leftPaths.length !== rightPaths.length) return false;
  return leftPaths.every((path, index) => path === rightPaths[index]);
}

function areEntryKindMapsEqual(leftKinds = {}, rightKinds = {}) {
  const leftEntries = Object.entries(leftKinds);
  const rightEntries = Object.entries(rightKinds);
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([path, kind]) => rightKinds[path] === kind);
}

function isTerminalKeyboardTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("[data-terminal-shortcuts]")
    || target.closest(".xterm"),
  );
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
  const [tabSelectionMetaByTabId, setTabSelectionMetaByTabId] = useState({});
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
  const [recentFoldersState, setRecentFoldersState] = useState({
    isOpen: false,
    isLoading: false,
    position: { x: 24, y: 24 },
    entries: [],
  });
  const currentWindowIdRef = useRef("");
  const lastPointerPositionRef = useRef({ x: 24, y: 24 });
  const recentFoldersRequestIdRef = useRef(0);
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

  useWorkspaceLifecycle({ dispatch, currentWindowIdRef });

  const currentWindow = selectCurrentWindow(viewState.snapshot, viewState.currentWindowId);
  const tabs = selectTabsForWindow(viewState.snapshot, currentWindow);
  const tabTitlesByTabId = useWorkspaceTabTitles(tabs);
  const titledTabs = useMemo(() => tabs.map((tab) => ({
    ...tab,
    title: tabTitlesByTabId[tab.tabId] ?? tab.title,
  })), [tabTitlesByTabId, tabs]);
  const activeTab = selectActiveTab(viewState.snapshot, currentWindow);
  const activePaneState = getActivePaneState(activeTab);
  const activePaneSelectedPaths = useMemo(
    () => getSelectedPathsFromState(activePaneState?.filesystemState),
    [activePaneState?.filesystemState],
  );
  const activeTabSelectionMeta = activeTab?.tabId
    ? tabSelectionMetaByTabId[activeTab.tabId]
    : undefined;
  const activeSelectedEntryKinds = useMemo(() => {
    if (!activeTabSelectionMeta) return undefined;
    if (!arePathListsEqual(activeTabSelectionMeta.selectedPaths, activePaneSelectedPaths)) return undefined;
    const entryKinds = activeTabSelectionMeta.selectedEntryKinds;
    if (!entryKinds || Object.keys(entryKinds).length === 0) return undefined;
    return entryKinds;
  }, [activePaneSelectedPaths, activeTabSelectionMeta]);
  const commandContextBase = useMemo(() => ({
    activeTabId: activeTab?.tabId ?? "",
    activePaneId: activeTab?.activePaneId ?? "",
    activePanelType: activePaneState?.panelType ?? "",
    isFilesystemBrowsing: Boolean(activePaneState?.filesystemState?.currentPath),
    selectedPaths: activePaneSelectedPaths,
    selectedEntryKinds: activeSelectedEntryKinds,
  }), [
    activePaneSelectedPaths,
    activeSelectedEntryKinds,
    activePaneState?.filesystemState,
    activePaneState?.panelType,
    activeTab?.tabId,
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
  const shortcutContext = useMemo(
    () => ({ ...commandContextBase, source: "shortcut" }),
    [commandContextBase],
  );
  const shortcutCommands = useMemo(
    () => getCommandsForTrigger("shortcut", shortcutContext),
    [shortcutContext],
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
  const closeRecentFolders = useCallback(() => {
    setRecentFoldersState((state) => state.isOpen
      ? { ...state, isOpen: false, isLoading: false }
      : state);
  }, []);
  const openCommandPalette = useCallback(() => {
    const { x, y } = lastPointerPositionRef.current;
    setCommandPaletteState({
      isOpen: true,
      position: { x, y },
    });
    closeContextMenu();
    closeRecentFolders();
  }, [closeContextMenu, closeRecentFolders]);
  const openRecentFolders = useCallback(() => {
    const { x, y } = lastPointerPositionRef.current;
    const nextRequestId = recentFoldersRequestIdRef.current + 1;
    recentFoldersRequestIdRef.current = nextRequestId;
    setRecentFoldersState((state) => ({
      ...state,
      isOpen: true,
      isLoading: true,
      position: { x, y },
    }));
    closeCommandPalette();
    closeContextMenu();
    workspaceRecentFoldersList()
      .then((entries) => {
        if (recentFoldersRequestIdRef.current !== nextRequestId) return;
        const nextEntries = Array.isArray(entries) ? entries : [];
        setRecentFoldersState((state) => ({
          ...state,
          entries: nextEntries,
          isLoading: false,
        }));
      })
      .catch((error) => {
        if (recentFoldersRequestIdRef.current !== nextRequestId) return;
        setRecentFoldersState((state) => ({ ...state, entries: [], isLoading: false }));
        pushNotification?.({
          title: "Failed to load recent folders",
          message: getErrorMessage(error),
          tone: "error",
        });
      });
  }, [closeCommandPalette, closeContextMenu, pushNotification]);
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
      currentWindow,
      activeTab,
      workspaceActions,
      openCommandPalette,
      openRecentFolders,
    },
  ), [activeTab, currentWindow, openCommandPalette, openRecentFolders, workspaceActions]);
  const handleTabSelectedFilesChange = useCallback((tabId, selectedFiles) => {
    workspaceActions.handleSetTabSelectedFiles(tabId, selectedFiles);
    if (!tabId) return;

    const selectedPaths = getSelectedPathsFromState(selectedFiles);
    const rawSelectedEntryKinds = selectedFiles?.selectedEntryKinds;
    const nextSelectedEntryKinds = {};
    if (rawSelectedEntryKinds && typeof rawSelectedEntryKinds === "object") {
      selectedPaths.forEach((path) => {
        const kind = rawSelectedEntryKinds[path];
        if (kind === "file" || kind === "folder") nextSelectedEntryKinds[path] = kind;
      });
    }

    setTabSelectionMetaByTabId((previous) => {
      const previousMeta = previous[tabId];
      const hasSelection = selectedPaths.length > 0;
      if (!hasSelection) {
        if (!previousMeta) return previous;
        const { [tabId]: _removed, ...rest } = previous;
        return rest;
      }

      if (
        previousMeta
        && arePathListsEqual(previousMeta.selectedPaths, selectedPaths)
        && areEntryKindMapsEqual(previousMeta.selectedEntryKinds, nextSelectedEntryKinds)
      ) {
        return previous;
      }

      return {
        ...previous,
        [tabId]: {
          selectedPaths,
          selectedEntryKinds: nextSelectedEntryKinds,
        },
      };
    });
  }, [workspaceActions]);
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
  const handleRecentFolderSelect = useCallback(async (path) => {
    const targetPath = typeof path === "string" ? path.trim() : "";
    if (!targetPath) return;
    closeRecentFolders();
    const activeTabId = activeTab?.tabId ?? "";
    if (!activeTabId) return;

    try {
      await workspaceActions.handleOpenFolderInCurrentTab(activeTabId, targetPath);
      return;
    } catch (error) {
      const message = getErrorMessage(error);
      if (message === "Folder does not exist.") {
        pushNotification?.({
          title: "Folder no longer exists",
          message: targetPath,
          tone: "warning",
        });
        workspaceRecentFoldersRemove(targetPath).catch(() => {});
        setRecentFoldersState((state) => ({
          ...state,
          entries: state.entries.filter((entry) => entry.path !== targetPath),
        }));
        return;
      }
      pushNotification?.({
        title: "Failed to open folder",
        message,
        tone: "error",
      });
    }
  }, [
    activeTab?.tabId,
    closeRecentFolders,
    pushNotification,
    workspaceActions,
  ]);
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented || event.repeat) return;
      if (isEditableKeyboardTarget(event.target) && !isTerminalKeyboardTarget(event.target)) return;

      const matchedCommand = shortcutCommands.find(command => (
        isCommandShortcutMatch(command.id, event)
      ));
      if (!matchedCommand) return;

      event.preventDefault();
      executeAppCommand(matchedCommand.id, shortcutContext);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [executeAppCommand, shortcutCommands, shortcutContext]);

  useEffect(() => {
    if (!activeNotification) return;
    closeContextMenu();
    closeCommandPalette();
    closeRecentFolders();
  }, [activeNotification, closeCommandPalette, closeContextMenu, closeRecentFolders]);

  if (!currentWindow || !activeTab) {
    return <main className={styles.appShell}>
      <div className={styles.loadingShell}>
        <p className={styles.loadingText}>Loading workspace...</p>
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
        <PanelsDndLayer>
          <WorkspacePanelLayout
            tab={activeTab}
            cwdHint={activeTab.terminalCwdHint ?? ""}
            onCurrentPathChange={workspaceActions.handleSetTabCwdHint}
            onFilesystemStateChange={workspaceActions.handleSetPaneFilesystemState}
            onTabSelectedFilesChange={handleTabSelectedFilesChange}
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
    <RecentFoldersPopover
      open={recentFoldersState.isOpen}
      position={recentFoldersState.position}
      entries={recentFoldersState.entries}
      isLoading={recentFoldersState.isLoading}
      onSelect={handleRecentFolderSelect}
      onClose={closeRecentFolders}
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
