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
import useWorkspaceFolderStyles from "./workspace/useWorkspaceFolderStyles";
import useWorkspaceScripts from "./workspace/useWorkspaceScripts";
import useAppPreferences from "./workspace/useAppPreferences";
import { getErrorMessage } from "./workspace/appRuntime";
import { useNotificationCenter } from "./notifications/notificationCenter";
import resolveContextMenuTarget from "./context/resolveContextMenuTarget";
import CommandPalettePopover from "./components/popovers/CommandPalettePopover";
import ContextMenuPopover from "./components/popovers/ContextMenuPopover";
import RecentFoldersPopover from "./components/popovers/RecentFoldersPopover";
import SystemNotificationPopover from "./components/popovers/SystemNotificationPopover";
import useAppPopovers from "./components/popovers/useAppPopovers";
import {
  COMMAND_IDS,
  getCommandsForTrigger,
  isCommandShortcutMatch,
} from "./commands/commandRegistry";
import executeCommand from "./commands/executeCommand";
import { getSelectedPathsFromState } from "./utils/pathSelection";
import isEditableKeyboardTarget from "./utils/isEditableKeyboardTarget";
import { getPaneIdsInLayoutOrder } from "./components/workspacePanelLayoutUtils";
import { FILESYSTEM_FLUSH_STATE_EVENT } from "./components/FilesystemPanel/filesystemPanelEvents";
import usePreviewPaneTabs from "./components/PreviewPanel/usePreviewPaneTabs";

import styles from "./App.module.scss";

function getActivePaneState(activeTab) {
  const activePaneId = activeTab?.activePaneId ?? "";
  return activeTab?.paneStates?.[activePaneId] ?? null;
}

function resolvePrimaryFilesystemPaneId(tab = null) {
  const paneStates = tab?.paneStates ?? {};
  const paneIdsInLayoutOrder = getPaneIdsInLayoutOrder(tab?.layout);
  const firstFilesystemPaneId = paneIdsInLayoutOrder.find((paneId) => (
    paneStates[paneId]?.panelType === "Filesystem"
  ));
  if (firstFilesystemPaneId) return firstFilesystemPaneId;

  return Object.keys(paneStates).find((paneId) => paneStates[paneId]?.panelType === "Filesystem")
    ?? "";
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

function createWorkspaceScriptCommandId(scriptName = "") {
  return `${COMMAND_IDS.WORKSPACE_RUN_SCRIPT}:${encodeURIComponent(scriptName)}`;
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
  const currentWindowIdRef = useRef("");
  const {
    activeNotification,
    pushNotification,
    openConfirm,
    dismissNotification,
    closeNotificationWithDefault,
    resolveConfirmNotification,
  } = useNotificationCenter();
  const { preferences, toggleShowHiddenFiles } = useAppPreferences({ pushNotification });
  const {
    commandPaletteState,
    contextMenuState,
    recentFoldersState,
    openCommandPalette,
    closeCommandPalette,
    openContextMenu,
    closeContextMenu,
    openRecentFolders,
    closeRecentFolders,
    refreshRecentFolders,
    forgetRecentFolder,
    handlePointerMoveCapture,
  } = useAppPopovers({ activeNotification, pushNotification });
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
  const workspaceScripts = useWorkspaceScripts(activeTab?.workspaceRoot ?? "");
  const primaryFilesystemPaneId = useMemo(
    () => resolvePrimaryFilesystemPaneId(activeTab),
    [activeTab],
  );
  const activePaneState = getActivePaneState(activeTab);
  useWorkspaceFolderStyles({ activeTab, activePaneState });
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
    // For marking the current view and sort in menus. The pane under the pointer is the active
    // one, so for the context menu this is also the right-clicked pane.
    filesystemViewType: activePaneState?.filesystemState?.viewType,
    filesystemSortKey: activePaneState?.filesystemState?.sortKey,
    filesystemSortDescending: activePaneState?.filesystemState?.sortDescending,
    showHiddenFiles: preferences?.showHiddenFiles, // null until loaded; the loading shell shows then
  }), [
    activePaneSelectedPaths,
    activeSelectedEntryKinds,
    activePaneState?.filesystemState,
    activePaneState?.panelType,
    activeTab?.tabId,
    activeTab?.activePaneId,
    preferences?.showHiddenFiles,
  ]);
  const paletteContext = useMemo(
    () => ({ ...commandContextBase, source: "palette" }),
    [commandContextBase],
  );
  const workspaceScriptCommands = useMemo(
    () => workspaceScripts.map((script) => ({
      id: createWorkspaceScriptCommandId(script.name),
      title: `workspace: ${script.name}`,
      shortcut: "",
      scriptName: script.name,
      scriptCommand: script.command,
    })),
    [workspaceScripts],
  );
  const workspaceScriptByCommandId = useMemo(
    () => Object.fromEntries(
      workspaceScriptCommands.map((command) => [command.id, command]),
    ),
    [workspaceScriptCommands],
  );
  const paletteCommands = useMemo(
    () => [
      ...getCommandsForTrigger("palette", paletteContext),
      ...workspaceScriptCommands,
    ],
    [paletteContext, workspaceScriptCommands],
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
    activeTabPreviewPaneStateById,
    handlePaneActivate,
    handleSplitPaneWithPanelType,
    handleOpenPreviewPath,
    handleActivatePreviewTab,
    handleClosePreviewTab,
    handleUpdatePreviewTab,
    handleMovePreviewTabs,
    previewSelectedFile,
  } = usePreviewPaneTabs({ snapshot: viewState.snapshot, activeTab, workspaceActions });
  const handleSetActiveTab = useCallback((tabId) => {
    window.dispatchEvent(new CustomEvent(FILESYSTEM_FLUSH_STATE_EVENT));
    workspaceActions.handleSetActiveTab(tabId);
  }, [workspaceActions]);
  const workspaceActionsForCommands = useMemo(() => ({
    ...workspaceActions,
    handleSetActiveTab,
  }), [handleSetActiveTab, workspaceActions]);

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

  const executeAppCommand = useCallback((commandId, context = {}) => executeCommand(
    commandId,
    {
      context,
      currentWindow,
      activeTab,
      workspaceActions: workspaceActionsForCommands,
      openCommandPalette,
      openRecentFolders,
      toggleShowHiddenFiles,
    },
  ), [
    activeTab,
    currentWindow,
    openCommandPalette,
    openRecentFolders,
    toggleShowHiddenFiles,
    workspaceActionsForCommands,
  ]);
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
      pointerX: event.clientX,
      pointerY: event.clientY,
    };
    const isShellMenuAvailable = getCommandsForTrigger("context-menu", context)
      .some(command => command.id === COMMAND_IDS.FILESYSTEM_SHOW_SHELL_MENU);
    if (event.shiftKey && isShellMenuAvailable) {
      closeContextMenu();
      executeAppCommand(COMMAND_IDS.FILESYSTEM_SHOW_SHELL_MENU, { ...context, extendedVerbs: true });
      return;
    }
    openContextMenu({ x: event.clientX, y: event.clientY }, target, context);
  }, [closeContextMenu, commandContextBase, executeAppCommand, openContextMenu]);
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

    const selectedFilePath = selectedPaths.find((path) => nextSelectedEntryKinds[path] === "file");
    if (selectedFilePath) previewSelectedFile(tabId, selectedFilePath, selectedFiles?.previewOpenMode);

    setTabSelectionMetaByTabId((previous) => {
      const previousMeta = previous[tabId];
      const hasSelection = selectedPaths.length > 0;
      if (!hasSelection) {
        if (!previousMeta) return previous;
        const rest = { ...previous };
        delete rest[tabId];
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
  }, [previewSelectedFile, workspaceActions]);
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
    const workspaceScriptCommand = workspaceScriptByCommandId[commandId];
    if (workspaceScriptCommand) {
      workspaceActions.handleRunWorkspaceScript({
        tabId: activeTab?.tabId ?? "",
        paneId: activeTab?.activePaneId ?? "",
        scriptName: workspaceScriptCommand.scriptName,
        command: workspaceScriptCommand.scriptCommand,
      });
      return;
    }
    executeAppCommand(commandId, paletteContext);
  }, [
    activeTab?.activePaneId,
    activeTab?.tabId,
    closeCommandPalette,
    executeAppCommand,
    paletteContext,
    workspaceActions,
    workspaceScriptByCommandId,
  ]);
  const openFolderInCurrentTabViaRecentFlow = useCallback(async (tabId, path, options = {}) => {
    const suppressNotFoundNotification = options?.suppressNotFoundNotification === true;
    const targetPath = typeof path === "string" ? path.trim() : "";
    if (!tabId || !targetPath) return false;

    try {
      await workspaceActions.handleOpenFolderInCurrentTab(tabId, targetPath);
      refreshRecentFolders({ notifyOnError: false });
      return true;
    } catch (error) {
      const message = getErrorMessage(error);
      if (message === "Folder does not exist.") {
        if (!suppressNotFoundNotification) {
          pushNotification?.({
            title: "Folder no longer exists",
            message: targetPath,
            tone: "warning",
          });
          forgetRecentFolder(targetPath);
        }
        return false;
      }

      pushNotification?.({
        title: "Failed to open folder",
        message,
        tone: "error",
      });
      return false;
    }
  }, [forgetRecentFolder, pushNotification, refreshRecentFolders, workspaceActions]);
  const handleRecentFolderSelect = useCallback((path) => {
    closeRecentFolders();
    const activeTabId = activeTab?.tabId ?? "";
    if (!activeTabId) return;
    openFolderInCurrentTabViaRecentFlow(activeTabId, path);
  }, [activeTab?.tabId, closeRecentFolders, openFolderInCurrentTabViaRecentFlow]);
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
    refreshRecentFolders({ notifyOnError: false });
  }, [activeTab?.tabId, activeTab?.terminalCwdHint, refreshRecentFolders]);

  if (!currentWindow || !activeTab || !preferences) {
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
          onActivateTab={handleSetActiveTab}
          onCloseTab={workspaceActions.handleCloseTab}
          onMiddleClickTab={handleTabMiddleClick}
          onCreateTab={workspaceActions.handleCreateTab}
        />
      </DndContext>

      <section className={`${styles.workspaceContent} workspaceContent`}>
        <PanelsDndLayer>
          <WorkspacePanelLayout
            tab={activeTab}
            previewPaneStateById={activeTabPreviewPaneStateById}
            primaryFilesystemPaneId={primaryFilesystemPaneId}
            cwdHint={activeTab.terminalCwdHint ?? ""}
            recentFoldersEntries={recentFoldersState.entries}
            recentFoldersLoading={recentFoldersState.isLoading}
            showHiddenFiles={preferences.showHiddenFiles}
            onOpenFolderInCurrentTab={openFolderInCurrentTabViaRecentFlow}
            onCurrentPathChange={workspaceActions.handleSetTabCwdHint}
            onFilesystemStateChange={workspaceActions.handleSetPaneFilesystemState}
            onTabSelectedFilesChange={handleTabSelectedFilesChange}
            onPanelTypeChange={workspaceActions.handleChangePanelType}
            onPaneActivate={handlePaneActivate}
            onPaneSplit={workspaceActions.handleSplitPane}
            onPaneClose={workspaceActions.handleClosePane}
            onPaneDirtyStateChange={workspaceActions.handlePaneDirtyStateChange}
            onSplitRatioChange={workspaceActions.handleSetSplitRatio}
            onOpenPreviewPath={handleOpenPreviewPath}
            onActivatePreviewTab={handleActivatePreviewTab}
            onClosePreviewTab={handleClosePreviewTab}
            onUpdatePreviewTab={handleUpdatePreviewTab}
            onSplitPaneWithPanelType={handleSplitPaneWithPanelType}
            onMovePreviewTabs={handleMovePreviewTabs}
          />
        </PanelsDndLayer>
      </section>
    </section>
    <CommandPalettePopover
      open={commandPaletteState.isOpen}
      position={commandPaletteState.position}
      commands={paletteCommands}
      context={paletteContext}
      onCommand={handlePaletteCommand}
      onClose={closeCommandPalette}
    />
    <ContextMenuPopover
      open={contextMenuState.isOpen}
      position={contextMenuState.position}
      target={contextMenuState.target}
      commands={contextMenuCommands}
      context={contextMenuState.context}
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
