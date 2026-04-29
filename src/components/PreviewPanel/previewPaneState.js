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

function normalizeUniquePaths(paths = []) {
  const normalizedPaths = [];
  paths.forEach((path) => {
    const normalizedPath = normalizePath(path);
    if (!normalizedPath) return;
    if (normalizedPaths.some(candidatePath => isSamePath(candidatePath, normalizedPath))) return;
    normalizedPaths.push(normalizedPath);
  });
  return normalizedPaths;
}

export function getPreviewTabsByPaths(state = undefined, paths = []) {
  const normalizedState = normalizePreviewPaneState(state);
  const normalizedPaths = normalizeUniquePaths(paths);
  if (normalizedPaths.length === 0) return [];

  return normalizedPaths
    .map((path) => {
      const tabIndex = findPreviewTabIndexByPath(normalizedState.tabs, path);
      return tabIndex >= 0 ? normalizedState.tabs[tabIndex] : null;
    })
    .filter(tab => tab !== null);
}

export function removePreviewTabsByPaths(state = undefined, paths = []) {
  const normalizedState = normalizePreviewPaneState(state);
  const normalizedPaths = normalizeUniquePaths(paths);
  if (normalizedPaths.length === 0) return normalizedState;

  const removeIndexes = normalizedPaths
    .map(path => findPreviewTabIndexByPath(normalizedState.tabs, path))
    .filter(index => index >= 0)
    .sort((leftIndex, rightIndex) => leftIndex - rightIndex);
  if (removeIndexes.length === 0) return normalizedState;

  const tabs = normalizedState.tabs.filter((tab, index) => !removeIndexes.includes(index));
  if (tabs.length === 0) return createEmptyPreviewPaneState();

  const activePathWasRemoved = normalizedPaths.some(path => isSamePath(path, normalizedState.activePath));
  if (!activePathWasRemoved) {
    return normalizePreviewPaneState({
      tabs,
      activePath: normalizedState.activePath,
    });
  }

  const fallbackIndex = Math.max(0, removeIndexes[0] - 1);
  const fallbackPath = tabs[fallbackIndex]?.path ?? tabs[0]?.path ?? "";
  return normalizePreviewPaneState({
    tabs,
    activePath: fallbackPath,
  });
}

export function insertPreviewTabs(state = undefined, tabsToInsert = [], options = {}) {
  const normalizedState = normalizePreviewPaneState(state);
  const normalizedTabsToInsert = tabsToInsert
    .map(tab => normalizePreviewTab(tab))
    .filter(tab => tab !== null);
  if (normalizedTabsToInsert.length === 0) return normalizedState;

  const insertPaths = normalizedTabsToInsert.map(tab => tab.path);
  const baseState = removePreviewTabsByPaths(normalizedState, insertPaths);
  const tabs = [...baseState.tabs];

  let insertIndex = tabs.length;
  const targetPath = normalizePath(options?.targetPath);
  if (targetPath) {
    const targetIndex = findPreviewTabIndexByPath(tabs, targetPath);
    if (targetIndex >= 0) {
      insertIndex = options?.targetSide === "left" ? targetIndex : targetIndex + 1;
    }
  }
  if (Number.isInteger(options?.index)) {
    insertIndex = Math.min(Math.max(0, options.index), tabs.length);
  }

  tabs.splice(insertIndex, 0, ...normalizedTabsToInsert);
  const requestedActivePath = normalizePath(options?.activePath);
  const activePath = requestedActivePath
    ? requestedActivePath
    : (normalizedTabsToInsert.at(-1)?.path ?? "");

  return normalizePreviewPaneState({
    tabs,
    activePath,
  });
}
