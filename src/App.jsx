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
import { getSelectedPathsFromState, uniqueNonEmptyPaths } from "./utils/pathSelection";
import isEditableKeyboardTarget from "./utils/isEditableKeyboardTarget";
import { getPaneIdsInLayoutOrder } from "./components/workspacePanelLayoutUtils";
import { FILESYSTEM_FLUSH_STATE_EVENT } from "./components/FilesystemPanel/filesystemPanelEvents";
import {
  arePreviewPaneStatesEqual,
  closePreviewTab,
  getPreviewTabsByPaths,
  insertPreviewTabs,
  normalizePreviewPaneState,
  openPathInPreviewPaneState,
  removePreviewTabsByPaths,
  setActivePreviewTab,
  updatePreviewTab,
} from "./components/PreviewPanel/previewPaneState";

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

function getPreviewPaneIds(tab = null) {
  const paneStates = tab?.paneStates ?? {};
  const paneIdsInLayoutOrder = getPaneIdsInLayoutOrder(tab?.layout);
  const orderedPreviewPaneIds = paneIdsInLayoutOrder.filter((paneId) => (
    paneStates[paneId]?.panelType === "Preview"
  ));
  const unorderedPreviewPaneIds = Object.keys(paneStates).filter((paneId) => (
    paneStates[paneId]?.panelType === "Preview"
    && !orderedPreviewPaneIds.includes(paneId)
  ));
  return [...orderedPreviewPaneIds, ...unorderedPreviewPaneIds];
}

function resolvePreviewPaneId(tab = null, preferredPaneId = "") {
  const paneStates = tab?.paneStates ?? {};
  if (preferredPaneId && paneStates[preferredPaneId]?.panelType === "Preview") {
    return preferredPaneId;
  }

  const activePaneId = tab?.activePaneId ?? "";
  if (paneStates[activePaneId]?.panelType === "Preview") return activePaneId;

  const firstPreviewPaneId = getPreviewPaneIds(tab)[0];
  if (firstPreviewPaneId) return firstPreviewPaneId;

  return "";
}

function resolveSelectedFilePath(selectedPaths = [], selectedEntryKinds = {}) {
  if (!Array.isArray(selectedPaths) || selectedPaths.length === 0) return "";
  const filePath = selectedPaths.find((path) => selectedEntryKinds[path] === "file");
  if (filePath) return filePath;
  return "";
}

function prunePreviewPaneStateBySnapshot(previousState = {}, snapshot = null) {
  const previousEntries = Object.entries(previousState);
  if (previousEntries.length === 0) return previousState;

  const tabs = Array.isArray(snapshot?.tabs) ? snapshot.tabs : [];
  const tabsById = new Map(tabs.map(tab => [tab?.tabId ?? "", tab]));
  const nextState = {};
  let changed = false;

  previousEntries.forEach(([tabId, paneStateById]) => {
    const tab = tabsById.get(tabId);
    if (!tab || !paneStateById || typeof paneStateById !== "object") {
      changed = true;
      return;
    }

    const nextPaneStateById = {};
    Object.entries(paneStateById).forEach(([paneId, paneState]) => {
      if (tab?.paneStates?.[paneId]?.panelType !== "Preview") {
        changed = true;
        return;
      }

      const normalizedPaneState = normalizePreviewPaneState(paneState);
      if (normalizedPaneState.tabs.length === 0) {
        changed = true;
        return;
      }

      if (!arePreviewPaneStatesEqual(paneState, normalizedPaneState)) changed = true;
      nextPaneStateById[paneId] = normalizedPaneState;
    });

    const paneCount = Object.keys(nextPaneStateById).length;
    if (paneCount === 0) {
      changed = true;
      return;
    }

    if (paneCount !== Object.keys(paneStateById).length) changed = true;
    nextState[tabId] = nextPaneStateById;
  });

  if (!changed && Object.keys(nextState).length !== previousEntries.length) changed = true;
  return changed ? nextState : previousState;
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
  const [previewPaneStateByTabId, setPreviewPaneStateByTabId] = useState({});
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
  const lastPreviewPaneIdByTabIdRef = useRef(new Map());
  const autoClosingPreviewPaneKeysRef = useRef(new Set());
  const previewSplitGraceUntilByPaneKeyRef = useRef(new Map());
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
  const workspaceScripts = useWorkspaceScripts(activeTab?.workspaceRoot ?? "");
  const activeTabPreviewPaneStateById = useMemo(
    () => (activeTab?.tabId ? (previewPaneStateByTabId[activeTab.tabId] ?? {}) : {}),
    [activeTab?.tabId, previewPaneStateByTabId],
  );
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
  const rememberPreviewPaneId = useCallback((tabId, paneId) => {
    if (!tabId || !paneId) return;
    lastPreviewPaneIdByTabIdRef.current.set(tabId, paneId);
  }, []);
  const resolveTabById = useCallback((tabId) => {
    if (!tabId) return null;
    if (activeTab?.tabId === tabId) return activeTab;
    const tabs = Array.isArray(viewState.snapshot?.tabs) ? viewState.snapshot.tabs : [];
    return tabs.find((tab) => tab?.tabId === tabId) ?? null;
  }, [activeTab, viewState.snapshot?.tabs]);
  const handlePaneActivate = useCallback((tabId, paneId) => {
    if (!tabId || !paneId) return;
    const tabForPane = resolveTabById(tabId);
    if (tabForPane?.paneStates?.[paneId]?.panelType === "Preview") {
      rememberPreviewPaneId(tabId, paneId);
    }
    workspaceActions.handleSetActivePane(tabId, paneId);
  }, [rememberPreviewPaneId, resolveTabById, workspaceActions.handleSetActivePane]);
  const handleSplitPaneWithPanelType = useCallback(async (
    tabId,
    paneId,
    direction,
    newPanelType = null,
  ) => {
    const splitResult = await workspaceActions.handleSplitPaneWithPanelType(
      tabId,
      paneId,
      direction,
      newPanelType,
    );
    const newPaneId = typeof splitResult?.newPaneId === "string"
      ? splitResult.newPaneId
      : "";
    if (!tabId || !newPaneId || newPanelType !== "Preview") return splitResult;

    rememberPreviewPaneId(tabId, newPaneId);
    const graceUntil = Date.now() + 1200;
    previewSplitGraceUntilByPaneKeyRef.current.set(`${tabId}::${newPaneId}`, graceUntil);
    return splitResult;
  }, [rememberPreviewPaneId, workspaceActions.handleSplitPaneWithPanelType]);
  const updatePreviewPaneState = useCallback((tabId, paneId, updater) => {
    if (!tabId || !paneId || typeof updater !== "function") return;

    setPreviewPaneStateByTabId((previous) => {
      const previousTabState = previous[tabId] ?? {};
      const previousPaneState = normalizePreviewPaneState(previousTabState[paneId]);
      const nextPaneState = normalizePreviewPaneState(updater(previousPaneState));
      if (arePreviewPaneStatesEqual(previousPaneState, nextPaneState)) return previous;

      const nextTabState = { ...previousTabState };
      if (nextPaneState.tabs.length === 0) {
        delete nextTabState[paneId];
      } else {
        nextTabState[paneId] = nextPaneState;
      }

      if (Object.keys(nextTabState).length === 0) {
        if (!(tabId in previous)) return previous;
        const nextState = { ...previous };
        delete nextState[tabId];
        return nextState;
      }

      return {
        ...previous,
        [tabId]: nextTabState,
      };
    });
  }, []);
  const handleOpenPreviewPath = useCallback((tabId, paneId, path, options = {}) => {
    if (!tabId || !paneId || !path) return;
    rememberPreviewPaneId(tabId, paneId);
    const openAsEphemeral = options?.openMode !== "pinned";
    updatePreviewPaneState(tabId, paneId, (paneState) => openPathInPreviewPaneState(
      paneState,
      path,
      { openAsEphemeral },
    ));
  }, [rememberPreviewPaneId, updatePreviewPaneState]);
  const handleActivatePreviewTab = useCallback((tabId, paneId, path) => {
    if (!tabId || !paneId || !path) return;
    rememberPreviewPaneId(tabId, paneId);
    updatePreviewPaneState(tabId, paneId, paneState => setActivePreviewTab(paneState, path));
  }, [rememberPreviewPaneId, updatePreviewPaneState]);
  const handleClosePreviewTab = useCallback((tabId, paneId, path) => {
    if (!tabId || !paneId || !path) return;
    rememberPreviewPaneId(tabId, paneId);
    updatePreviewPaneState(tabId, paneId, paneState => closePreviewTab(paneState, path));
  }, [rememberPreviewPaneId, updatePreviewPaneState]);
  const handleUpdatePreviewTab = useCallback((tabId, paneId, path, patch = {}) => {
    if (!tabId || !paneId || !path || !patch || typeof patch !== "object") return;
    rememberPreviewPaneId(tabId, paneId);
    updatePreviewPaneState(tabId, paneId, paneState => updatePreviewTab(paneState, path, patch));
  }, [rememberPreviewPaneId, updatePreviewPaneState]);
  const handleMovePreviewTabs = useCallback((
    tabId,
    sourcePaneId,
    targetPaneId,
    paths = [],
    options = {},
  ) => {
    if (!tabId || !sourcePaneId || !targetPaneId) return;
    const normalizedPaths = uniqueNonEmptyPaths(paths);
    if (normalizedPaths.length === 0) return;
    rememberPreviewPaneId(tabId, targetPaneId);

    setPreviewPaneStateByTabId((previous) => {
      const previousTabState = previous[tabId] ?? {};
      const sourcePaneState = normalizePreviewPaneState(previousTabState[sourcePaneId]);
      const targetPaneState = normalizePreviewPaneState(previousTabState[targetPaneId]);
      const movedTabs = getPreviewTabsByPaths(sourcePaneState, normalizedPaths)
        .map((tab) => ({
          ...tab,
          isEphemeral: options?.pinTabs === true ? false : tab.isEphemeral,
        }));
      if (movedTabs.length === 0) return previous;

      const movedPaths = movedTabs.map(tab => tab.path);
      const sourceAfterRemoval = removePreviewTabsByPaths(sourcePaneState, movedPaths);
      const targetBaseState = sourcePaneId === targetPaneId
        ? sourceAfterRemoval
        : targetPaneState;
      const targetAfterInsert = insertPreviewTabs(targetBaseState, movedTabs, {
        ...(options?.insert === "append" ? { index: targetBaseState.tabs.length } : {}),
        targetPath: options?.targetPath,
        targetSide: options?.targetSide,
        activePath: movedTabs.at(-1)?.path ?? "",
      });

      const nextTabState = { ...previousTabState };
      if (sourcePaneId !== targetPaneId) {
        if (sourceAfterRemoval.tabs.length === 0) delete nextTabState[sourcePaneId];
        else nextTabState[sourcePaneId] = sourceAfterRemoval;
      }
      if (targetAfterInsert.tabs.length === 0) delete nextTabState[targetPaneId];
      else nextTabState[targetPaneId] = targetAfterInsert;

      const sourceUnchanged = sourcePaneId === targetPaneId
        || arePreviewPaneStatesEqual(previousTabState[sourcePaneId], nextTabState[sourcePaneId]);
      const targetUnchanged = arePreviewPaneStatesEqual(
        previousTabState[targetPaneId],
        nextTabState[targetPaneId],
      );
      if (sourceUnchanged && targetUnchanged) return previous;

      if (Object.keys(nextTabState).length === 0) {
        if (!(tabId in previous)) return previous;
        const nextState = { ...previous };
        delete nextState[tabId];
        return nextState;
      }

      return {
        ...previous,
        [tabId]: nextTabState,
      };
    });
  }, [rememberPreviewPaneId]);
  useEffect(() => {
    setPreviewPaneStateByTabId(previous => (
      prunePreviewPaneStateBySnapshot(previous, viewState.snapshot)
    ));
  }, [viewState.snapshot]);
  useEffect(() => {
    const tabs = Array.isArray(viewState.snapshot?.tabs) ? viewState.snapshot.tabs : [];
    if (tabs.length === 0) {
      lastPreviewPaneIdByTabIdRef.current.clear();
      return;
    }

    const tabsById = new Map(tabs.map((tab) => [tab?.tabId ?? "", tab]));
    const rememberedPreviewPanes = lastPreviewPaneIdByTabIdRef.current;
    Array.from(rememberedPreviewPanes.entries()).forEach(([tabId, paneId]) => {
      const paneState = tabsById.get(tabId)?.paneStates?.[paneId];
      if (paneState?.panelType !== "Preview") {
        rememberedPreviewPanes.delete(tabId);
      }
    });
  }, [viewState.snapshot?.tabs]);
  useEffect(() => {
    const tabId = activeTab?.tabId ?? "";
    if (!tabId) return;

    const previewPaneIds = getPreviewPaneIds(activeTab);
    if (previewPaneIds.length <= 1) return;

    const previewPaneStateById = previewPaneStateByTabId[tabId] ?? {};
    const now = Date.now();
    const graceEntries = previewSplitGraceUntilByPaneKeyRef.current;
    Array.from(graceEntries.entries()).forEach(([key, graceUntil]) => {
      if (graceUntil <= now) graceEntries.delete(key);
    });

    const emptyPreviewPaneIds = previewPaneIds.filter((paneId) => {
      const paneState = normalizePreviewPaneState(previewPaneStateById[paneId]);
      return paneState.tabs.length === 0;
    });
    if (emptyPreviewPaneIds.length === 0) return;

    let closablePreviewPaneIds = emptyPreviewPaneIds.filter((paneId) => (
      paneId !== activeTab?.activePaneId
    ));
    closablePreviewPaneIds = closablePreviewPaneIds.filter((paneId) => {
      const paneKey = `${tabId}::${paneId}`;
      const graceUntil = graceEntries.get(paneKey) ?? 0;
      return graceUntil <= now;
    });
    if (closablePreviewPaneIds.length === 0) return;

    const maxClosures = previewPaneIds.length - 1;
    closablePreviewPaneIds.slice(0, maxClosures).forEach((paneId) => {
      const closeKey = `${tabId}::${paneId}`;
      if (autoClosingPreviewPaneKeysRef.current.has(closeKey)) return;
      autoClosingPreviewPaneKeysRef.current.add(closeKey);
      Promise.resolve(workspaceActions.handleClosePane(tabId, paneId))
        .finally(() => {
          autoClosingPreviewPaneKeysRef.current.delete(closeKey);
        });
    });
  }, [activeTab, previewPaneStateByTabId, workspaceActions.handleClosePane]);
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
  const refreshRecentFolders = useCallback(async ({ notifyOnError = false } = {}) => {
    const nextRequestId = recentFoldersRequestIdRef.current + 1;
    recentFoldersRequestIdRef.current = nextRequestId;
    setRecentFoldersState((state) => ({ ...state, isLoading: true }));

    try {
      const entries = await workspaceRecentFoldersList();
      if (recentFoldersRequestIdRef.current !== nextRequestId) return [];
      const nextEntries = Array.isArray(entries) ? entries : [];
      setRecentFoldersState((state) => ({
        ...state,
        entries: nextEntries,
        isLoading: false,
      }));
      return nextEntries;
    } catch (error) {
      if (recentFoldersRequestIdRef.current !== nextRequestId) return [];
      setRecentFoldersState((state) => ({ ...state, entries: [], isLoading: false }));
      if (notifyOnError) {
        pushNotification?.({
          title: "Failed to load recent folders",
          message: getErrorMessage(error),
          tone: "error",
        });
      }
      return [];
    }
  }, [pushNotification]);
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
    setRecentFoldersState((state) => ({
      ...state,
      isOpen: true,
      position: { x, y },
    }));
    closeCommandPalette();
    closeContextMenu();
    refreshRecentFolders({ notifyOnError: true });
  }, [closeCommandPalette, closeContextMenu, refreshRecentFolders]);
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
      workspaceActions: workspaceActionsForCommands,
      openCommandPalette,
      openRecentFolders,
    },
  ), [activeTab, currentWindow, openCommandPalette, openRecentFolders, workspaceActionsForCommands]);
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

    const selectedFilePath = resolveSelectedFilePath(selectedPaths, nextSelectedEntryKinds);
    if (selectedFilePath) {
      const tabForSelection = resolveTabById(tabId);
      const preferredPreviewPaneId = lastPreviewPaneIdByTabIdRef.current.get(tabId) ?? "";
      const targetPreviewPaneId = resolvePreviewPaneId(tabForSelection, preferredPreviewPaneId);
      if (targetPreviewPaneId) {
        rememberPreviewPaneId(tabId, targetPreviewPaneId);
        const openMode = selectedFiles?.previewOpenMode === "pinned"
          ? "pinned"
          : "ephemeral";
        handleOpenPreviewPath(tabId, targetPreviewPaneId, selectedFilePath, {
          openMode,
        });
      }
    }

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
  }, [handleOpenPreviewPath, rememberPreviewPaneId, resolveTabById, workspaceActions]);
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
          workspaceRecentFoldersRemove(targetPath).catch(() => { });
          setRecentFoldersState((state) => ({
            ...state,
            entries: state.entries.filter((entry) => entry.path !== targetPath),
          }));
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
  }, [pushNotification, refreshRecentFolders, workspaceActions]);
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
    if (!activeNotification) return;
    closeContextMenu();
    closeCommandPalette();
    closeRecentFolders();
  }, [activeNotification, closeCommandPalette, closeContextMenu, closeRecentFolders]);
  useEffect(() => {
    refreshRecentFolders({ notifyOnError: false });
  }, [activeTab?.tabId, activeTab?.terminalCwdHint, refreshRecentFolders]);

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
