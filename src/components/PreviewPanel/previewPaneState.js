import { isSamePath } from "../../utils/pathWatch";

function normalizePath(path) {
  return typeof path === "string" ? path.trim() : "";
}

function normalizePreviewTab(tab = undefined) {
  const path = normalizePath(tab?.path);
  if (!path) return null;

  return {
    path,
    isEphemeral: Boolean(tab?.isEphemeral),
    isDirty: Boolean(tab?.isDirty),
    draftContent: typeof tab?.draftContent === "string" ? tab.draftContent : "",
  };
}

export function createEmptyPreviewPaneState() {
  return {
    tabs: [],
    activePath: "",
  };
}

export function normalizePreviewPaneState(state = undefined) {
  const normalizedTabs = Array.isArray(state?.tabs)
    ? state.tabs
      .map(tab => normalizePreviewTab(tab))
      .filter(tab => tab !== null)
    : [];
  const activePath = normalizePath(state?.activePath);
  const hasActiveTab = normalizedTabs.some(tab => isSamePath(tab.path, activePath));

  return {
    tabs: normalizedTabs,
    activePath: hasActiveTab ? activePath : (normalizedTabs[0]?.path ?? ""),
  };
}

export function arePreviewPaneStatesEqual(leftState, rightState) {
  const left = normalizePreviewPaneState(leftState);
  const right = normalizePreviewPaneState(rightState);
  if (!isSamePath(left.activePath, right.activePath)) return false;
  if (left.tabs.length !== right.tabs.length) return false;

  return left.tabs.every((leftTab, index) => {
    const rightTab = right.tabs[index];
    if (!rightTab) return false;
    return isSamePath(leftTab.path, rightTab.path)
      && leftTab.isEphemeral === rightTab.isEphemeral
      && leftTab.isDirty === rightTab.isDirty
      && leftTab.draftContent === rightTab.draftContent;
  });
}

export function findPreviewTabIndexByPath(tabs = [], path = "") {
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) return -1;
  return tabs.findIndex(tab => isSamePath(tab?.path, normalizedPath));
}

export function getActivePreviewTab(state = undefined) {
  const normalizedState = normalizePreviewPaneState(state);
  const activeIndex = findPreviewTabIndexByPath(normalizedState.tabs, normalizedState.activePath);
  if (activeIndex < 0) return null;
  return normalizedState.tabs[activeIndex];
}

export function openPathInPreviewPaneState(
  state = undefined,
  path = "",
  options = {},
) {
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) return normalizePreviewPaneState(state);

  const openAsEphemeral = options?.openAsEphemeral !== false;
  const normalizedState = normalizePreviewPaneState(state);
  const tabs = [...normalizedState.tabs];
  const existingIndex = findPreviewTabIndexByPath(tabs, normalizedPath);

  if (existingIndex >= 0) {
    const existingTab = tabs[existingIndex];
    const shouldPinExistingTab = !openAsEphemeral && existingTab.isEphemeral;
    if (shouldPinExistingTab) {
      tabs[existingIndex] = {
        ...existingTab,
        isEphemeral: false,
      };
    }

    return normalizePreviewPaneState({
      tabs,
      activePath: tabs[existingIndex].path,
    });
  }

  const previousEphemeralIndex = tabs.findIndex(tab => tab.isEphemeral);
  let insertIndex = tabs.length;
  if (previousEphemeralIndex >= 0) {
    tabs.splice(previousEphemeralIndex, 1);
    insertIndex = previousEphemeralIndex;
  }

  const newTab = {
    path: normalizedPath,
    isEphemeral: openAsEphemeral,
    isDirty: false,
    draftContent: "",
  };
  tabs.splice(insertIndex, 0, newTab);

  return normalizePreviewPaneState({
    tabs,
    activePath: normalizedPath,
  });
}

export function setActivePreviewTab(state = undefined, path = "") {
  const normalizedState = normalizePreviewPaneState(state);
  const tabIndex = findPreviewTabIndexByPath(normalizedState.tabs, path);
  if (tabIndex < 0) return normalizedState;

  return normalizePreviewPaneState({
    ...normalizedState,
    activePath: normalizedState.tabs[tabIndex].path,
  });
}

export function closePreviewTab(state = undefined, path = "") {
  const normalizedState = normalizePreviewPaneState(state);
  const tabIndex = findPreviewTabIndexByPath(normalizedState.tabs, path);
  if (tabIndex < 0) return normalizedState;

  const tabs = [...normalizedState.tabs];
  const [removedTab] = tabs.splice(tabIndex, 1);
  if (!removedTab) return normalizedState;

  const removedWasActive = isSamePath(removedTab.path, normalizedState.activePath);
  let activePath = normalizedState.activePath;
  if (removedWasActive) {
    const fallbackTab = tabs[Math.max(0, tabIndex - 1)] ?? tabs[0] ?? null;
    activePath = fallbackTab?.path ?? "";
  }

  return normalizePreviewPaneState({
    tabs,
    activePath,
  });
}

export function updatePreviewTab(state = undefined, path = "", patch = {}) {
  const normalizedState = normalizePreviewPaneState(state);
  const tabIndex = findPreviewTabIndexByPath(normalizedState.tabs, path);
  if (tabIndex < 0) return normalizedState;

  const currentTab = normalizedState.tabs[tabIndex];
  const nextTab = {
    ...currentTab,
    ...(typeof patch?.isEphemeral === "boolean" ? { isEphemeral: patch.isEphemeral } : {}),
    ...(typeof patch?.isDirty === "boolean" ? { isDirty: patch.isDirty } : {}),
    ...(typeof patch?.draftContent === "string" ? { draftContent: patch.draftContent } : {}),
  };
  if (
    nextTab.isEphemeral === currentTab.isEphemeral
    && nextTab.isDirty === currentTab.isDirty
    && nextTab.draftContent === currentTab.draftContent
  ) {
    return normalizedState;
  }

  const tabs = [...normalizedState.tabs];
  tabs[tabIndex] = nextTab;
  return normalizePreviewPaneState({
    ...normalizedState,
    tabs,
  });
}
