import { useCallback, useRef } from "react";
import { ensureWorkspaceWindowCreated, getErrorMessage } from "./appRuntime";
import {
  workspaceCloseTab,
  workspaceCloseTabPane,
  workspaceNewTab,
  workspaceNewWindow,
  workspaceSetActiveTab,
  workspaceSetTabActivePane,
  workspaceSetTabLayoutSplitRatio,
  workspaceSetTabPaneFilesystemState,
  workspaceSetTabPanelType,
  workspaceSetTabSelectedFiles,
  workspaceSetTabTerminalCwd,
  workspaceSplitTabPane,
} from "./workspaceApi";

function resolveTabPaneId(tab, preferredPaneId = "") {
  if (preferredPaneId && tab?.paneStates?.[preferredPaneId]) return preferredPaneId;
  if (tab?.activePaneId && tab?.paneStates?.[tab.activePaneId]) return tab.activePaneId;
  return Object.keys(tab?.paneStates ?? {})[0] ?? "";
}

function getPaneStateKey(tabId, paneId) {
  return `${tabId}::${paneId}`;
}

export default function useWorkspaceActions({
  currentWindow = null,
  activeTab = null,
  pushNotification = undefined,
  openConfirm = undefined,
  setRuntimeError = undefined,
}) {
  const paneDirtyStateRef = useRef(new Map());

  const handleWorkspaceCommandError = useCallback(error => {
    const message = getErrorMessage(error);
    setRuntimeError?.(message);
    pushNotification?.({
      title: "Action failed",
      message,
      tone: "error",
      autoOpen: true,
    });
  }, [pushNotification, setRuntimeError]);

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

  const handleClosePane = useCallback(async (tabId, paneId) => {
    if (!tabId || !paneId) return;

    const paneState = activeTab?.tabId === tabId
      ? activeTab.paneStates?.[paneId]
      : null;
    const paneStateKey = getPaneStateKey(tabId, paneId);
    const paneDirtyState = paneDirtyStateRef.current.get(paneStateKey);
    const requiresUnsavedConfirm = paneState?.panelType === "Preview"
      && paneDirtyState?.hasUnsavedChanges;

    if (requiresUnsavedConfirm) {
      const shouldClose = await openConfirm?.({
        title: "Discard unsaved changes?",
        message: paneDirtyState.message || "Close this pane and discard unsaved changes?",
        tone: "warning",
        confirmLabel: "Close pane",
        cancelLabel: "Cancel",
        autoOpen: true,
      });
      if (!shouldClose) return;
    }

    workspaceCloseTabPane(tabId, paneId)
      .then(() => {
        paneDirtyStateRef.current.delete(paneStateKey);
      })
      .catch(handleTabScopedCommandError);
  }, [activeTab, handleTabScopedCommandError, openConfirm]);

  const handlePaneDirtyStateChange = useCallback((tabId, paneId, dirtyState, panelType) => {
    if (!tabId || !paneId) return;

    const paneStateKey = getPaneStateKey(tabId, paneId);
    const hasUnsavedChanges = Boolean(dirtyState?.hasUnsavedChanges);

    if (!hasUnsavedChanges) {
      paneDirtyStateRef.current.delete(paneStateKey);
      return;
    }

    paneDirtyStateRef.current.set(paneStateKey, {
      hasUnsavedChanges,
      panelType: panelType ?? "",
      scope: typeof dirtyState?.scope === "string" ? dirtyState.scope : "",
      message: typeof dirtyState?.message === "string" ? dirtyState.message : "",
    });
  }, []);

  const handleSetSplitRatio = useCallback((tabId, splitPath, ratio) => {
    if (!tabId || !splitPath) return;
    workspaceSetTabLayoutSplitRatio(tabId, splitPath, ratio).catch(handleTabScopedCommandError);
  }, [handleTabScopedCommandError]);

  const handleSetTabSelectedFiles = useCallback((tabId, selectedFiles) => {
    if (!tabId) return;
    workspaceSetTabSelectedFiles(tabId, selectedFiles).catch(handleTabScopedCommandError);
  }, [handleTabScopedCommandError]);

  const handleSplitActivePane = useCallback((direction) => {
    if (!activeTab?.tabId) return;
    const paneId = resolveTabPaneId(activeTab);
    if (!paneId) return;
    handleSplitPane(activeTab.tabId, paneId, direction);
  }, [activeTab, handleSplitPane]);

  return {
    handleWorkspaceCommandError,
    handleSetActiveTab,
    handleCreateTab,
    handleCreateWindow,
    handleCloseTab,
    handleChangePanelType,
    handleSetTabCwdHint,
    handleSetPaneFilesystemState,
    handleSetActivePane,
    handleSplitPane,
    handleClosePane,
    handlePaneDirtyStateChange,
    handleSetSplitRatio,
    handleSetTabSelectedFiles,
    handleSplitActivePane,
  };
}
