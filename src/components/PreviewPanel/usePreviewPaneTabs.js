import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPaneIdsInLayoutOrder } from "../workspacePanelLayoutUtils";
import { uniqueNonEmptyPaths } from "../../utils/pathSelection";
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
} from "./previewPaneState";

// A freshly split Preview pane is still empty; don't auto-close it right away.
const SPLIT_GRACE_MS = 1200;

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

  return getPreviewPaneIds(tab)[0] ?? "";
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

function setPaneState(tabState, paneId, paneState) {
  if (paneState.tabs.length === 0) delete tabState[paneId];
  else tabState[paneId] = paneState;
}

function withTabState(previous, tabId, nextTabState) {
  if (Object.keys(nextTabState).length > 0) return { ...previous, [tabId]: nextTabState };
  if (!(tabId in previous)) return previous;
  const nextState = { ...previous };
  delete nextState[tabId];
  return nextState;
}

// Open preview tabs, keyed by workspace tab and Preview pane.
export default function usePreviewPaneTabs({ snapshot, activeTab, workspaceActions }) {
  const {
    handleSetActivePane,
    handleSplitPaneWithPanelType: splitPaneWithPanelType,
    handleClosePane,
  } = workspaceActions;
  const [previewPaneStateByTabId, setPreviewPaneStateByTabId] = useState({});
  const lastPreviewPaneIdByTabIdRef = useRef(new Map());
  const autoClosingPreviewPaneKeysRef = useRef(new Set());
  const previewSplitGraceUntilByPaneKeyRef = useRef(new Map());

  const activeTabPreviewPaneStateById = useMemo(
    () => (activeTab?.tabId ? (previewPaneStateByTabId[activeTab.tabId] ?? {}) : {}),
    [activeTab?.tabId, previewPaneStateByTabId],
  );

  const rememberPreviewPaneId = useCallback((tabId, paneId) => {
    if (!tabId || !paneId) return;
    lastPreviewPaneIdByTabIdRef.current.set(tabId, paneId);
  }, []);
  const resolveTabById = useCallback((tabId) => {
    if (!tabId) return null;
    if (activeTab?.tabId === tabId) return activeTab;
    const tabs = Array.isArray(snapshot?.tabs) ? snapshot.tabs : [];
    return tabs.find((tab) => tab?.tabId === tabId) ?? null;
  }, [activeTab, snapshot?.tabs]);
  const handlePaneActivate = useCallback((tabId, paneId) => {
    if (!tabId || !paneId) return;
    if (resolveTabById(tabId)?.paneStates?.[paneId]?.panelType === "Preview") {
      rememberPreviewPaneId(tabId, paneId);
    }
    handleSetActivePane(tabId, paneId);
  }, [handleSetActivePane, rememberPreviewPaneId, resolveTabById]);
  const handleSplitPaneWithPanelType = useCallback(async (
    tabId,
    paneId,
    direction,
    newPanelType = null,
  ) => {
    const splitResult = await splitPaneWithPanelType(tabId, paneId, direction, newPanelType);
    const newPaneId = typeof splitResult?.newPaneId === "string"
      ? splitResult.newPaneId
      : "";
    if (!tabId || !newPaneId || newPanelType !== "Preview") return splitResult;

    rememberPreviewPaneId(tabId, newPaneId);
    previewSplitGraceUntilByPaneKeyRef.current.set(`${tabId}::${newPaneId}`, Date.now() + SPLIT_GRACE_MS);
    return splitResult;
  }, [rememberPreviewPaneId, splitPaneWithPanelType]);
  const updatePreviewPaneState = useCallback((tabId, paneId, updater) => {
    if (!tabId || !paneId) return;

    setPreviewPaneStateByTabId((previous) => {
      const previousTabState = previous[tabId] ?? {};
      const previousPaneState = normalizePreviewPaneState(previousTabState[paneId]);
      const nextPaneState = normalizePreviewPaneState(updater(previousPaneState));
      if (arePreviewPaneStatesEqual(previousPaneState, nextPaneState)) return previous;

      const nextTabState = { ...previousTabState };
      setPaneState(nextTabState, paneId, nextPaneState);
      return withTabState(previous, tabId, nextTabState);
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
  // Shows a file selected in a Filesystem pane in the tab's last used Preview pane.
  const previewSelectedFile = useCallback((tabId, path, openMode) => {
    const preferredPaneId = lastPreviewPaneIdByTabIdRef.current.get(tabId) ?? "";
    const paneId = resolvePreviewPaneId(resolveTabById(tabId), preferredPaneId);
    handleOpenPreviewPath(tabId, paneId, path, { openMode });
  }, [handleOpenPreviewPath, resolveTabById]);
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
    if (!tabId || !paneId || !path) return;
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
      if (sourcePaneId !== targetPaneId) setPaneState(nextTabState, sourcePaneId, sourceAfterRemoval);
      setPaneState(nextTabState, targetPaneId, targetAfterInsert);

      const sourceUnchanged = sourcePaneId === targetPaneId
        || arePreviewPaneStatesEqual(previousTabState[sourcePaneId], nextTabState[sourcePaneId]);
      const targetUnchanged = arePreviewPaneStatesEqual(
        previousTabState[targetPaneId],
        nextTabState[targetPaneId],
      );
      if (sourceUnchanged && targetUnchanged) return previous;

      return withTabState(previous, tabId, nextTabState);
    });
  }, [rememberPreviewPaneId]);

  useEffect(() => {
    setPreviewPaneStateByTabId(previous => prunePreviewPaneStateBySnapshot(previous, snapshot));
  }, [snapshot]);
  useEffect(() => {
    const tabs = Array.isArray(snapshot?.tabs) ? snapshot.tabs : [];
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
  }, [snapshot?.tabs]);
  // Empty Preview panes close themselves, except the active one, a just split one and the last one.
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

    const closablePreviewPaneIds = previewPaneIds.filter((paneId) => (
      normalizePreviewPaneState(previewPaneStateById[paneId]).tabs.length === 0
      && paneId !== activeTab?.activePaneId
      && (graceEntries.get(`${tabId}::${paneId}`) ?? 0) <= now
    ));
    if (closablePreviewPaneIds.length === 0) return;

    const maxClosures = previewPaneIds.length - 1;
    closablePreviewPaneIds.slice(0, maxClosures).forEach((paneId) => {
      const closeKey = `${tabId}::${paneId}`;
      if (autoClosingPreviewPaneKeysRef.current.has(closeKey)) return;
      autoClosingPreviewPaneKeysRef.current.add(closeKey);
      Promise.resolve(handleClosePane(tabId, paneId))
        .finally(() => {
          autoClosingPreviewPaneKeysRef.current.delete(closeKey);
        });
    });
  }, [activeTab, handleClosePane, previewPaneStateByTabId]);

  return {
    activeTabPreviewPaneStateById,
    handlePaneActivate,
    handleSplitPaneWithPanelType,
    handleOpenPreviewPath,
    handleActivatePreviewTab,
    handleClosePreviewTab,
    handleUpdatePreviewTab,
    handleMovePreviewTabs,
    previewSelectedFile,
  };
}
