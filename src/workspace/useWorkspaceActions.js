import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getErrorMessage } from "./appRuntime";
import {
  workspaceCloseTab,
  workspaceCloseTabPane,
  workspaceNewWindow,
  workspaceNewTab,
  workspaceSetActiveTab,
  workspaceSetTabActivePane,
  workspaceSetTabLayoutSplitRatio,
  workspaceSetTabPaneFilesystemState,
  workspaceSetTabPanelType,
  workspaceReplaceTabFolder,
  workspaceRecentFoldersRecord,
  workspaceSetTabSelectedFiles,
  workspaceSetTabTerminalCwd,
  workspaceSetTabWorkspaceRoot,
  workspaceSplitTabPane,
} from "./workspaceApi";

function resolveTabPaneId(tab = null) {
  if (tab?.activePaneId && tab?.paneStates?.[tab.activePaneId]) return tab.activePaneId;
  return Object.keys(tab?.paneStates ?? {})[0] ?? "";
}

function resolveTerminalSessionIdFromSplitResult(splitResult, tabId, paneId) {
  const resolvedTabId = typeof tabId === "string" ? tabId : "";
  const resolvedPaneId = typeof paneId === "string" ? paneId : "";
  if (!resolvedTabId || !resolvedPaneId) return "";

  const snapshot = splitResult?.snapshot;
  const tabs = Array.isArray(snapshot?.tabs) ? snapshot.tabs : [];
  const targetTab = tabs.find((tab) => tab?.tabId === resolvedTabId);
  const targetPane = targetTab?.paneStates?.[resolvedPaneId];
  return typeof targetPane?.terminalSessionId === "string" ? targetPane.terminalSessionId : "";
}

const getPaneStateKey = (tabId, paneId) => `${tabId}::${paneId}`;

function normalizePathForComparison(path) {
  const normalized = typeof path === "string" ? path.trim() : "";
  if (!normalized) return "";
  return normalized
    .trim()
    .replace(/[\\/]+$/, "")
    .replaceAll("\\", "/")
    .toLowerCase();
}

function isPathInsideRoot(path, rootPath) {
  const normalizedPath = normalizePathForComparison(path);
  const normalizedRootPath = normalizePathForComparison(rootPath);
  if (!normalizedPath || !normalizedRootPath) return false;
  return normalizedPath === normalizedRootPath || normalizedPath.startsWith(`${normalizedRootPath}/`);
}

export default function useWorkspaceActions({
  currentWindow = null,
  activeTab = null,
  pushNotification,
  openConfirm,
}) {
  const paneDirtyStateRef = useRef(new Map());
  const terminalCwdByTabRef = useRef(new Map());
  const activeTabId = activeTab?.tabId ?? "";
  const activeTabTerminalCwdHint = activeTab?.terminalCwdHint ?? "";

  useEffect(() => {
    if (!activeTabId) return;
    terminalCwdByTabRef.current.set(activeTabId, activeTabTerminalCwdHint);
  }, [activeTabId, activeTabTerminalCwdHint]);

  const showActionErrorNotification = useCallback((message) => {
    pushNotification?.({
      title: "Action failed",
      message,
      tone: "error",
    });
  }, [pushNotification]);

  const handleWorkspaceCommandError = useCallback(error => {
    const message = getErrorMessage(error);
    showActionErrorNotification(message);
  }, [showActionErrorNotification]);

  const handleTabScopedCommandError = useCallback(error => {
    const message = getErrorMessage(error);
    if (message === "Tab not found." || message === "Pane not found.") return;
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

  const handleCreateWindow = useCallback(() => {
    workspaceNewWindow().catch(handleWorkspaceCommandError);
  }, [handleWorkspaceCommandError]);

  const handleCloseTab = useCallback(tabId => {
    if (!currentWindow) return;
    workspaceCloseTab(currentWindow.windowId, tabId).catch(handleWorkspaceCommandError);
  }, [currentWindow, handleWorkspaceCommandError]);

  const handleChangePanelType = useCallback((tabId, paneId, panelType) => {
    if (!tabId) return;
    workspaceSetTabPanelType(tabId, paneId, panelType).catch(handleTabScopedCommandError);
  }, [handleTabScopedCommandError]);

  const handleSetTabCwdHint = useCallback((tabId, _paneId, path = "") => {
    if (!tabId) return;
    const previousPath = terminalCwdByTabRef.current.get(tabId);
    if (previousPath !== path) {
      terminalCwdByTabRef.current.set(tabId, path);
      workspaceSetTabTerminalCwd(tabId, path).catch((error) => {
        terminalCwdByTabRef.current.delete(tabId);
        handleTabScopedCommandError(error);
      });
      if (path) {
        workspaceRecentFoldersRecord(path).catch(() => {});
      }
    }

    if (activeTab?.tabId !== tabId) return;
    const workspaceRoot = activeTab?.workspaceRoot ?? "";
    if (!workspaceRoot) return;
    if (isPathInsideRoot(path, workspaceRoot)) return;

    workspaceSetTabWorkspaceRoot(tabId, null).catch(handleTabScopedCommandError);
  }, [activeTab, handleTabScopedCommandError]);

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

    const paneState = activeTab?.tabId === tabId ? activeTab.paneStates?.[paneId] : null;
    const paneStateKey = getPaneStateKey(tabId, paneId);
    const paneDirtyState = paneDirtyStateRef.current.get(paneStateKey);
    const requiresUnsavedConfirm = paneState?.panelType === "Preview"
      && paneDirtyState?.hasUnsavedChanges;

    if (requiresUnsavedConfirm) {
      const shouldClose = openConfirm ? await openConfirm({
        title: "Discard unsaved changes?",
        message: paneDirtyState.message || "Close this pane and discard unsaved changes?",
        tone: "warning",
        confirmLabel: "Close pane",
        cancelLabel: "Cancel",
      }) : true;
      if (!shouldClose) return;
    }

    try {
      await workspaceCloseTabPane(tabId, paneId);
      paneDirtyStateRef.current.delete(paneStateKey);
    } catch (error) {
      handleTabScopedCommandError(error);
    }
  }, [activeTab, handleTabScopedCommandError, openConfirm]);

  const handlePaneDirtyStateChange = useCallback((tabId, paneId, dirtyState) => {
    if (!tabId || !paneId) return;

    const paneStateKey = getPaneStateKey(tabId, paneId);
    const hasUnsavedChanges = Boolean(dirtyState?.hasUnsavedChanges);
    if (!hasUnsavedChanges) {
      paneDirtyStateRef.current.delete(paneStateKey);
      return;
    }

    const message = typeof dirtyState?.message === "string" ? dirtyState.message : "";
    paneDirtyStateRef.current.set(paneStateKey, {
      hasUnsavedChanges,
      message,
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

  const handleOpenFolderInCurrentTab = useCallback(async (tabId, path) => {
    if (!tabId || !path) return;
    await workspaceReplaceTabFolder(tabId, path);
  }, []);

  const handleRunWorkspaceScript = useCallback(async ({
    tabId = activeTab?.tabId ?? "",
    paneId = resolveTabPaneId(activeTab),
    scriptName = "",
    command = "",
  } = {}) => {
    const normalizedTabId = typeof tabId === "string" ? tabId : "";
    const normalizedPaneId = typeof paneId === "string" ? paneId : "";
    const normalizedCommand = typeof command === "string" ? command.trim() : "";
    const normalizedScriptName = typeof scriptName === "string" ? scriptName.trim() : "";

    if (!normalizedTabId || !normalizedPaneId || !normalizedCommand) return false;

    try {
      const splitResult = await workspaceSplitTabPane(
        normalizedTabId,
        normalizedPaneId,
        "bottom",
        "Terminal",
      );
      const newPaneId = typeof splitResult?.newPaneId === "string"
        ? splitResult.newPaneId
        : "";
      const terminalSessionId = resolveTerminalSessionIdFromSplitResult(
        splitResult,
        normalizedTabId,
        newPaneId,
      );
      if (!terminalSessionId) {
        throw new Error("Terminal session unavailable for the newly created pane.");
      }

      await invoke("terminal_run_command", {
        sessionId: terminalSessionId,
        command: normalizedCommand,
      });
      return true;
    } catch (error) {
      const message = getErrorMessage(error);
      if (message === "Tab not found." || message === "Pane not found.") return false;

      const scriptDisplayName = normalizedScriptName || "workspace script";
      showActionErrorNotification(`Failed to run "${scriptDisplayName}": ${message}`);
      return false;
    }
  }, [activeTab, showActionErrorNotification]);

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
    handleOpenFolderInCurrentTab,
    handleRunWorkspaceScript,
  };
}
