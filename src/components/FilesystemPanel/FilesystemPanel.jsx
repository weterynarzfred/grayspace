import { useDroppable } from "@dnd-kit/core";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PanelHeader from "../PanelHeader";
import { buildBreadcrumbs } from "./Breadcrumbs";
import FilesystemPanelListContent from "./FilesystemPanelListContent";
import FilesystemStatusMessages from "./FilesystemStatusMessages";
import {
  FILESYSTEM_THUMBNAIL_SIZE_STEPS,
  FILESYSTEM_VIEW_TYPES,
  normalizeFilesystemPaneState,
} from "./filesystemPaneState";
import { isPathInsideRoot } from "./filesystemPanelUtils";
import useFilesystemNavigation from "./hooks/useFilesystemNavigation";
import useFilesystemPanelInteractions from "./hooks/useFilesystemPanelInteractions";
import useFilesystemStatePersistence from "./hooks/useFilesystemStatePersistence";
import useFilesystemThumbnails from "./hooks/useFilesystemThumbnails";
import useFilesystemTree from "./hooks/useFilesystemTree";
import useFilesystemWorkspaceFolders from "./hooks/useFilesystemWorkspaceFolders";
import useVirtualizedEntryWindow from "./hooks/useVirtualizedEntryWindow";
import useFilesystemPanelLoadMore from "./hooks/useFilesystemPanelLoadMore";
import useGridColumnCount from "./hooks/useGridColumnCount";
import {
  clearFilesystemClipboard,
  readFilesystemClipboard,
  writeFilesystemClipboard,
} from "./filesystemClipboardApi";
import {
  clearFilesystemClipboardState,
  getFilesystemClipboardState,
  setFilesystemClipboardState,
} from "./filesystemClipboardStore";
import { useNotificationCenter } from "../../notifications/notificationCenter";
import isEditableKeyboardTarget from "../../utils/isEditableKeyboardTarget";
import { uniqueNonEmptyPaths } from "../../utils/pathSelection";
import { getParentDirectoryPath, isSamePath } from "../../utils/pathWatch";
import { COMMAND_IDS, isCommandShortcutMatch } from "../../commands/commandRegistry";
import { APP_COMMAND_EVENT } from "../../commands/commandEvents";
import executeCommand from "../../commands/executeCommand";
import { FILESYSTEM_FLUSH_STATE_EVENT } from "./filesystemPanelEvents";
import styles from "./FilesystemPanel.module.scss";
import shellStyles from "../PanelShell.module.scss";

const ENTRY_WINDOWING_THRESHOLD = 200;
const DRIVES_VIEW_STYLE_KEY = "::drives::";
const GRID_GAP_PX = 8;
const GRID_PADDING_PX = 8;
const GRID_LABEL_HEIGHT_PX = 32;
const THUMBNAIL_SIZE_TOGGLE_TITLE = "Toggle icon/thumbnail size";
const HISTORY_BACK_BUTTON_TITLE = "Go back in folder history";
const HISTORY_FORWARD_BUTTON_TITLE = "Go forward in folder history";

function normalizeDriveLetterPath(path) {
  if (typeof path !== "string") return "";
  const trimmedPath = path.trim();
  if (!trimmedPath) return "";

  return trimmedPath
    .replace(/^(\\\\[?.]\\\\)([a-z]):/i, (_fullMatch, prefix, driveLetter) => (
      `${prefix}${driveLetter.toUpperCase()}:`
    ))
    .replace(/^([a-z]):/, (_fullMatch, driveLetter) => `${driveLetter.toUpperCase()}:`);
}

function FilesystemPanel({
  tabId = "",
  paneId = "",
  panelType = "Filesystem",
  panelLabel = "",
  isPrimaryFilesystemPane = true,
  tabWorkspaceRoot = "",
  onOpenFolderInCurrentTab = undefined,
  onPanelTypeChange = undefined,
  onCurrentPathChange = undefined,
  onFilesystemStateChange = undefined,
  onTabSelectedFilesChange = undefined,
  filesystemState = undefined,
  recentFoldersEntries = [],
  recentFoldersLoading = false,
}) {
  const panelRef = useRef(null);
  const panelScrollRef = useRef(null);
  const entryWindowAnchorRef = useRef(null);
  const gridAnchorRef = useRef(null);
  const onCurrentPathChangeRef = useRef(onCurrentPathChange);
  const isFirstPathRef = useRef(tabWorkspaceRoot !== "");
  const pathLoadEpochRef = useRef(0);
  const tabWorkspaceRootRef = useRef(tabWorkspaceRoot);
  tabWorkspaceRootRef.current = tabWorkspaceRoot;
  const initialFilesystemStateRef = useRef(normalizeFilesystemPaneState(filesystemState));
  const [expandedPaths, setExpandedPaths] = useState(initialFilesystemStateRef.current.expandedPaths);
  const [thumbnailSizePx, setThumbnailSizePx] = useState(
    initialFilesystemStateRef.current.thumbnailSizePx,
  );
  const [viewType, setViewType] = useState(initialFilesystemStateRef.current.viewType);
  const [breadcrumbFocusRequestKey, setBreadcrumbFocusRequestKey] = useState(0);
  const thumbnailSizePxRef = useRef(thumbnailSizePx);
  thumbnailSizePxRef.current = thumbnailSizePx;
  const entryRowHeightPx = thumbnailSizePx;
  const { openConfirm, pushNotification } = useNotificationCenter();
  const nav = useFilesystemNavigation(initialFilesystemStateRef.current, {
    tabId,
    tabWorkspaceRoot,
    pushNotification,
  });
  const {
    currentDrive,
    currentPath,
    selectedPaths,
    entries,
    drives,
    isLoadingDrives,
    isLoadingEntries,
    isLoadingMoreEntries,
    hasMoreEntries,
    totalEntriesCount,
    hasLoadedCurrentPath,
    canGoBack,
    canGoForward,
    isMovingEntry,
    isDeletingEntries,
    isImportingExternal,
    error,
    setSelectedPath,
    selectDrive,
    navigateToPath,
    loadMoreEntries,
    goBack,
    goForward,
    selectEntry,
    openEntry,
    moveEntries,
    copyEntries,
    deleteEntries,
    importExternalPaths,
    renameEntry,
    createTextFile,
    createFolder,
    undoEntries,
    redoEntries,
  } = nav;
  const { handlePanelListScroll, flushFilesystemState } = useFilesystemStatePersistence({
    tabId,
    paneId,
    onFilesystemStateChange,
    panelListRef: panelScrollRef,
    initialFilesystemState: initialFilesystemStateRef.current,
    isLoadingEntries,
    isLoadingMoreEntries,
    hasMoreEntries,
    hasLoadedCurrentPath,
    currentDrive,
    currentPath,
    selectedPaths,
    expandedPaths,
    thumbnailSizePx,
    viewType,
  });
  const isBrowsing = currentPath !== "";
  const isEntryOperationInProgress = isMovingEntry || isDeletingEntries || isImportingExternal;
  const isExternalDragEnabled = isBrowsing && !isEntryOperationInProgress;
  const {
    treeRows,
    toggleDirectoryExpanded,
    remapRenamedPath,
  } = useFilesystemTree({
    currentPath,
    rootEntries: entries,
    initialExpandedPaths: initialFilesystemStateRef.current.expandedPaths,
    onExpandedPathsChange: setExpandedPaths,
  });
  const totalRootEntryCount = Math.max(totalEntriesCount, entries.length);
  const unresolvedRootEntryCount = Math.max(0, totalRootEntryCount - entries.length);
  const virtualRowCount = treeRows.length + unresolvedRootEntryCount;
  const isEntryWindowingEnabled = isBrowsing && virtualRowCount >= ENTRY_WINDOWING_THRESHOLD;
  const {
    startIndex: virtualStartIndex,
    endIndex: virtualEndIndex,
    topSpacerHeight,
    bottomSpacerHeight,
    scheduleRecompute: scheduleEntryWindowRecompute,
  } = useVirtualizedEntryWindow({
    itemCount: virtualRowCount,
    rowHeightPx: entryRowHeightPx,
    isEnabled: isEntryWindowingEnabled,
    scrollContainerRef: panelScrollRef,
    listStartAnchorRef: entryWindowAnchorRef,
  });
  const visibleRows = useMemo(() => {
    const visibleStart = Math.min(virtualStartIndex, treeRows.length);
    const visibleEnd = Math.min(virtualEndIndex, treeRows.length);
    return treeRows.slice(visibleStart, visibleEnd);
  }, [treeRows, virtualEndIndex, virtualStartIndex]);
  const renderedRows = isEntryWindowingEnabled ? visibleRows : treeRows;
  const visibleEntries = useMemo(() => renderedRows.map((row) => row.entry), [renderedRows]);

  const isGridView = viewType === "grid" && isBrowsing;
  const gridCellMinWidthPx = Math.max(72, thumbnailSizePx + 24);
  const gridCellHeightPx = thumbnailSizePx + GRID_LABEL_HEIGHT_PX;
  const gridRowHeightPx = gridCellHeightPx + GRID_GAP_PX;
  const gridColumns = useGridColumnCount(panelScrollRef, gridCellMinWidthPx, GRID_GAP_PX, GRID_PADDING_PX);
  const gridRowCount = Math.ceil(totalRootEntryCount / Math.max(1, gridColumns));
  const isGridWindowingEnabled = isGridView && gridRowCount >= ENTRY_WINDOWING_THRESHOLD;
  const {
    startIndex: gridVirtualStartIndex,
    endIndex: gridVirtualEndIndex,
    topSpacerHeight: gridTopSpacerHeight,
    bottomSpacerHeight: gridBottomSpacerHeight,
    scheduleRecompute: scheduleGridWindowRecompute,
  } = useVirtualizedEntryWindow({
    itemCount: gridRowCount,
    rowHeightPx: gridRowHeightPx,
    isEnabled: isGridWindowingEnabled,
    scrollContainerRef: panelScrollRef,
    listStartAnchorRef: gridAnchorRef,
  });
  const visibleGridEntries = useMemo(() => {
    if (!isGridView) return [];
    const startEntry = gridVirtualStartIndex * gridColumns;
    const endEntry = gridVirtualEndIndex * gridColumns;
    return entries.slice(startEntry, endEntry);
  }, [isGridView, gridVirtualStartIndex, gridVirtualEndIndex, gridColumns, entries]);

  const effectiveVisibleEntries = isGridView ? visibleGridEntries : visibleEntries;
  const { thumbnailSrcByPath } = useFilesystemThumbnails({
    currentPath,
    visibleEntries: effectiveVisibleEntries,
    thumbnailSizePx,
  });
  const breadcrumbs = buildBreadcrumbs(currentPath, currentDrive);
  const workspaceFolderPathSet = useFilesystemWorkspaceFolders({
    entries: visibleEntries,
    paths: breadcrumbs
      .map((crumb) => crumb.path)
      .filter((path) => typeof path === "string" && path),
  });
  const {
    treeData,
    selectedEntryPaths,
    selectedPathSet,
    selectedEntryPathSet,
    dnd,
    effectiveActiveDragPaths,
    effectiveActiveDragPathSet,
    effectiveActiveDropDestinationPath,
    isInternalDragActive,
    activeDragEntries,
    activeDragEntry,
    dragIntent,
    renamingPath,
    handleEntryClick,
    handleEntryDoubleClick,
    handleEntryMiddleClick,
    handleEntryContextMenu,
    handlePanelBackgroundClick,
    handlePanelBackgroundContextMenu,
    handleBeginRenameSelectedEntry,
    handleCreateTextFile,
    handleCreateFolder,
    handleEntryRenameCancel,
    handleEntryRenameSubmit,
    handleDeleteSelectedEntries,
    handlePanelKeyDown,
    handleOpenSelectedEntryInNewTab,
    isExternalDragOver,
  } = useFilesystemPanelInteractions({
    tabId,
    paneId,
    panelRef,
    currentPath,
    selectedPaths,
    drivePaths: drives.map((drive) => drive.path),
    treeRows,
    isBrowsing,
    isEntryOperationInProgress,
    isExternalDragEnabled,
    setSelectedPath,
    selectEntry,
    openEntry,
    moveEntries,
    copyEntries,
    importExternalPaths,
    deleteEntries,
    renameEntry,
    createTextFile,
    createFolder,
    onEntryPathRenamed: remapRenamedPath,
    onTabSelectedFilesChange,
    onDeleteShortcutCommand: () => executeFilesystemShortcutCommand(COMMAND_IDS.FILESYSTEM_DELETE_SELECTED),
    onToggleDirectoryExpanded: toggleDirectoryExpanded,
    onOpenDrivePath: selectDrive,
    workspaceFolderPathSet,
    openConfirm,
    pushNotification,
  });
  const upDestinationPath = breadcrumbs.length > 2 ? breadcrumbs.at(-2).path : "";
  const {
    isOver: isPanelDropOver,
    setNodeRef: setPanelDropNodeRef,
  } = useDroppable({
    id: dnd.getPanelDropId(currentPath),
    disabled: !isBrowsing || isEntryOperationInProgress,
    data: {
      kind: "panel",
      path: currentPath,
      isDirectory: true,
      paneId,
    },
  });
  const setPanelNodeRef = useCallback((node) => {
    panelRef.current = node;
    setPanelDropNodeRef(node);
  }, [setPanelDropNodeRef]);
  const isPanelActive = useCallback(() => {
    const paneViewport = panelRef.current?.closest("[data-pane-active]");
    if (!paneViewport) return panelRef.current?.contains(document.activeElement);
    return paneViewport.dataset.paneActive === "true";
  }, []);
  const executeFilesystemShortcutCommand = useCallback((commandId) => {
    executeCommand(commandId, {
      context: {
        source: "shortcut",
        activePaneId: paneId,
        targetPaneId: paneId,
      },
    });
  }, [paneId]);
  const resolveCommandSelectedEntryPaths = useCallback((commandContext = {}) => {
    const contextSelectedPaths = uniqueNonEmptyPaths(commandContext?.selectedPaths);
    if (contextSelectedPaths.length > 0) return contextSelectedPaths;
    return selectedEntryPaths;
  }, [selectedEntryPaths]);
  const handleClipboardSelectionCommand = useCallback((mode, commandContext = {}) => {
    if (!isBrowsing || isEntryOperationInProgress) return false;
    const selectedCommandPaths = resolveCommandSelectedEntryPaths(commandContext);
    if (selectedCommandPaths.length === 0) return false;

    setFilesystemClipboardState(mode, selectedCommandPaths);
    writeFilesystemClipboard(selectedCommandPaths, mode);
    return true;
  }, [
    isBrowsing,
    isEntryOperationInProgress,
    resolveCommandSelectedEntryPaths,
  ]);
  const resolvePasteDestination = useCallback((commandContext = {}) => {
    if (!currentPath) return "";
    const selectedCommandPaths = resolveCommandSelectedEntryPaths(commandContext);
    const selectedFolderPath = selectedCommandPaths.find((entryPath) => (
      treeData.entryByPath[entryPath]?.is_dir === true
    ));
    const selectedFilePath = selectedCommandPaths.find((entryPath) => (
      treeData.entryByPath[entryPath]?.is_dir === false
    ));

    if (
      commandContext?.source === "context-menu"
      && commandContext?.targetType === "folder"
      && commandContext?.targetScope === "tree-entry"
      && commandContext?.targetPath
    ) {
      return commandContext.targetPath;
    }

    if (selectedFolderPath) return selectedFolderPath;
    if (selectedFilePath) return getParentDirectoryPath(selectedFilePath) || currentPath;

    return currentPath;
  }, [
    currentPath,
    resolveCommandSelectedEntryPaths,
    treeData.entryByPath,
  ]);
  const handlePasteEntries = useCallback(async (commandContext = {}) => {
    if (!isBrowsing || isEntryOperationInProgress) return false;

    const systemClipboardState = await readFilesystemClipboard();
    const localClipboardState = getFilesystemClipboardState();
    const clipboardMode = systemClipboardState.mode || localClipboardState.mode;
    const clipboardPaths = uniqueNonEmptyPaths([
      ...(systemClipboardState.paths.length > 0 ? systemClipboardState.paths : []),
      ...(systemClipboardState.paths.length === 0 ? localClipboardState.paths : []),
    ]);
    if (!clipboardMode || clipboardPaths.length === 0) return false;

    const destinationDir = resolvePasteDestination(commandContext);
    if (!destinationDir) return false;

    if (clipboardMode === "copy") {
      await copyEntries(clipboardPaths, destinationDir);
      return true;
    }

    const actionableMovePaths = clipboardPaths.filter((sourcePath) => {
      if (isSamePath(sourcePath, destinationDir)) return false;
      const sourceParentPath = getParentDirectoryPath(sourcePath);
      if (sourceParentPath && isSamePath(sourceParentPath, destinationDir)) return false;
      return true;
    });
    if (actionableMovePaths.length === 0) return false;

    await moveEntries(actionableMovePaths, destinationDir);
    clearFilesystemClipboardState();
    await clearFilesystemClipboard();
    return true;
  }, [
    clearFilesystemClipboard,
    copyEntries,
    isBrowsing,
    isEntryOperationInProgress,
    moveEntries,
    readFilesystemClipboard,
    resolvePasteDestination,
  ]);
  const resolveCreateCommandOptions = useCallback((commandContext = {}) => {
    if (commandContext?.source !== "context-menu") return {};

    if (
      commandContext?.targetType === "folder"
      && commandContext?.targetScope === "tree-entry"
      && commandContext?.targetPath
    ) {
      return {
        parentDir: commandContext.targetPath,
        expandFolderPath: commandContext.targetPath,
      };
    }

    if (commandContext?.targetType === "panel") {
      return { parentDir: currentPath };
    }

    return {};
  }, [currentPath]);
  const canLeaveWorkspaceWithoutConfirm = useCallback((nextPath) => {
    if (!isPrimaryFilesystemPane) return true;
    if (!tabWorkspaceRoot) return true;
    return isPathInsideRoot(nextPath, tabWorkspaceRoot);
  }, [isPrimaryFilesystemPane, tabWorkspaceRoot]);
  const confirmWorkspaceExitIfNeeded = useCallback(async (nextPath) => {
    if (canLeaveWorkspaceWithoutConfirm(nextPath)) return true;
    const shouldLeaveWorkspace = await openConfirm({
      title: "Leave workspace?",
      message: "This will clear workspace context for this tab.",
      tone: "warning",
      confirmLabel: "Leave workspace",
      cancelLabel: "Stay",
    });
    return shouldLeaveWorkspace;
  }, [canLeaveWorkspaceWithoutConfirm, openConfirm]);
  const handleBreadcrumbSelect = useCallback(async (nextPath) => {
    if (!await confirmWorkspaceExitIfNeeded(nextPath)) return;
    navigateToPath(nextPath);
  }, [confirmWorkspaceExitIfNeeded, navigateToPath]);
  const handleOpenFolderViaRecentSelection = useCallback(async (nextPath, options = {}) => {
    const normalizedPath = normalizeDriveLetterPath(nextPath);
    if (!normalizedPath) return;
    const fallbackPathRaw = typeof options?.fallbackPath === "string"
      ? options.fallbackPath
      : "";
    const fallbackPath = normalizeDriveLetterPath(fallbackPathRaw);
    const hasFallbackPath = Boolean(fallbackPath) && !isSamePath(fallbackPath, normalizedPath);

    if (typeof onOpenFolderInCurrentTab === "function") {
      if (!hasFallbackPath) {
        await onOpenFolderInCurrentTab(tabId, normalizedPath);
        return;
      }
      const openedPrimary = await onOpenFolderInCurrentTab(tabId, normalizedPath, {
        suppressNotFoundNotification: true,
      });
      if (openedPrimary !== false) return;
      await onOpenFolderInCurrentTab(tabId, fallbackPath, {
        suppressNotFoundNotification: false,
      });
      return;
    }

    const localTargetPath = hasFallbackPath ? fallbackPath : normalizedPath;
    if (!await confirmWorkspaceExitIfNeeded(localTargetPath)) return;
    navigateToPath(localTargetPath);
  }, [
    confirmWorkspaceExitIfNeeded,
    navigateToPath,
    onOpenFolderInCurrentTab,
    tabId,
  ]);
  const loadSubfoldersForPath = useCallback(async (parentPath) => {
    const normalizedParentPath = typeof parentPath === "string"
      ? parentPath.trim()
      : "";
    if (!normalizedParentPath) return [];

    try {
      const entries = await invoke("list_directory", { path: normalizedParentPath });
      if (!Array.isArray(entries)) return [];
      return entries
        .filter((entry) => entry?.is_dir === true && typeof entry?.path === "string")
        .map((entry) => entry.path.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }, []);
  const handleGoUpDoubleClick = useCallback(async () => {
    if (!await confirmWorkspaceExitIfNeeded(upDestinationPath)) return;
    navigateToPath(upDestinationPath);
  }, [confirmWorkspaceExitIfNeeded, navigateToPath, upDestinationPath]);
  const requestBreadcrumbInputFocus = useCallback(() => {
    setBreadcrumbFocusRequestKey((current) => current + 1);
  }, []);

  useEffect(() => {
    onCurrentPathChangeRef.current = onCurrentPathChange;
  }, [onCurrentPathChange]);

  useEffect(() => {
    onCurrentPathChangeRef.current?.(currentPath);
  }, [currentPath]);

  useEffect(() => {
    isFirstPathRef.current = tabWorkspaceRootRef.current !== "";
    pathLoadEpochRef.current += 1;
  }, [paneId, tabId]);

  useEffect(() => {
    if (currentPath && isFirstPathRef.current) {
      isFirstPathRef.current = false;
      return;
    }
    const styleKey = currentPath || DRIVES_VIEW_STYLE_KEY;
    const epoch = ++pathLoadEpochRef.current;
    invoke("workspace_folder_view_styles_get", { path: styleKey }).then((style) => {
      if (pathLoadEpochRef.current !== epoch) return;
      if (!style) return;
      if (FILESYSTEM_VIEW_TYPES.includes(style.viewType)) setViewType(style.viewType);
      if (FILESYSTEM_THUMBNAIL_SIZE_STEPS.includes(style.thumbnailSizePx)) setThumbnailSizePx(style.thumbnailSizePx);
    }).catch(() => {});
  }, [currentPath]);

  useEffect(() => {
    if (panelScrollRef.current) panelScrollRef.current.scrollTop = 0;
  }, [viewType]);

  useEffect(() => {
    const handleFilesystemFlushRequest = () => {
      flushFilesystemState();
    };

    window.addEventListener(FILESYSTEM_FLUSH_STATE_EVENT, handleFilesystemFlushRequest);
    return () => {
      window.removeEventListener(FILESYSTEM_FLUSH_STATE_EVENT, handleFilesystemFlushRequest);
    };
  }, [flushFilesystemState]);

  useEffect(() => {
    const handleUndoRedoShortcut = (event) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.altKey || !event.ctrlKey) return;
      if (isEditableKeyboardTarget(event.target)) return;

      const pressedKey = event.key.toLowerCase();
      const wantsUndo = pressedKey === "z" && !event.shiftKey;
      const wantsRedo = pressedKey === "y" || (pressedKey === "z" && event.shiftKey);
      if (!wantsUndo && !wantsRedo) return;

      if (!isPanelActive()) return;
      if (isEntryOperationInProgress) return;

      event.preventDefault();
      if (wantsUndo) {
        undoEntries();
      } else {
        redoEntries();
      }
    };

    window.addEventListener("keydown", handleUndoRedoShortcut);
    return () => {
      window.removeEventListener("keydown", handleUndoRedoShortcut);
    };
  }, [isEntryOperationInProgress, isPanelActive, redoEntries, undoEntries]);

  useEffect(() => {
    const handleRenameShortcut = event => {
      if (event.defaultPrevented || event.repeat) return;
      if (!isCommandShortcutMatch(COMMAND_IDS.FILESYSTEM_RENAME_SELECTED, event)) return;
      if (isEditableKeyboardTarget(event.target)) return;

      if (!isPanelActive()) return;
      if (isEntryOperationInProgress) return;

      event.preventDefault();
      executeFilesystemShortcutCommand(COMMAND_IDS.FILESYSTEM_RENAME_SELECTED);
    };

    window.addEventListener("keydown", handleRenameShortcut);
    return () => {
      window.removeEventListener("keydown", handleRenameShortcut);
    };
  }, [executeFilesystemShortcutCommand, isEntryOperationInProgress, isPanelActive]);
  useEffect(() => {
    const handlePanelNavigationKeys = (event) => {
      if (event.defaultPrevented) return;
      if (!isPanelActive()) return;
      handlePanelKeyDown(event);
    };

    window.addEventListener("keydown", handlePanelNavigationKeys);
    return () => {
      window.removeEventListener("keydown", handlePanelNavigationKeys);
    };
  }, [handlePanelKeyDown, isPanelActive]);
  const saveFolderViewStyle = useCallback((path, vt, tspx) => {
    const styleKey = path || DRIVES_VIEW_STYLE_KEY;
    invoke("workspace_folder_view_styles_set", { path: styleKey, viewType: vt, thumbnailSizePx: tspx }).catch(() => {});
  }, []);
  useEffect(() => {
    const handleAppCommand = (event) => {
      const detail = event?.detail ?? {};
      const { commandId = "", context = {} } = detail;
      if (!commandId) return;

      const targetPaneId = context?.targetPaneId || context?.activePaneId || "";
      if (targetPaneId && targetPaneId !== paneId) return;

      const commandHandlers = {
        [COMMAND_IDS.FILESYSTEM_RENAME_SELECTED]: () => handleBeginRenameSelectedEntry(),
        [COMMAND_IDS.FILESYSTEM_COPY]: () => handleClipboardSelectionCommand("copy", context),
        [COMMAND_IDS.FILESYSTEM_CUT]: () => handleClipboardSelectionCommand("cut", context),
        [COMMAND_IDS.FILESYSTEM_PASTE]: () => handlePasteEntries(context),
        [COMMAND_IDS.FILESYSTEM_CREATE_TEXT_FILE]: () => {
          handleCreateTextFile(resolveCreateCommandOptions(context));
        },
        [COMMAND_IDS.FILESYSTEM_CREATE_FOLDER]: () => {
          handleCreateFolder(resolveCreateCommandOptions(context));
        },
        [COMMAND_IDS.FILESYSTEM_DELETE_SELECTED]: () => handleDeleteSelectedEntries(),
        [COMMAND_IDS.FILESYSTEM_UNDO]: () => undoEntries(),
        [COMMAND_IDS.FILESYSTEM_REDO]: () => redoEntries(),
        [COMMAND_IDS.FILESYSTEM_OPEN_SELECTED_FOLDER_IN_NEW_TAB]: () => {
          handleOpenSelectedEntryInNewTab();
        },
        [COMMAND_IDS.FILESYSTEM_GO_UP]: () => handleGoUpDoubleClick(),
        [COMMAND_IDS.FILESYSTEM_NAVIGATE_BACK]: () => goBack(),
        [COMMAND_IDS.FILESYSTEM_NAVIGATE_FORWARD]: () => goForward(),
        [COMMAND_IDS.FILESYSTEM_FOCUS_BREADCRUMB_INPUT]: () => requestBreadcrumbInputFocus(),
        [COMMAND_IDS.FILESYSTEM_VIEW_FOLDER_TREE]: () => {
          setViewType("folder-tree");
          saveFolderViewStyle(currentPath, "folder-tree", thumbnailSizePxRef.current);
        },
        [COMMAND_IDS.FILESYSTEM_VIEW_GRID]: () => {
          setViewType("grid");
          saveFolderViewStyle(currentPath, "grid", thumbnailSizePxRef.current);
        },
        [COMMAND_IDS.FILESYSTEM_VIEW_FOLDABLE_GRID]: () => {
          setViewType("foldable-grid");
          saveFolderViewStyle(currentPath, "foldable-grid", thumbnailSizePxRef.current);
        },
      };

      const commandHandler = commandHandlers[commandId];
      if (commandHandler) commandHandler();
    };

    window.addEventListener(APP_COMMAND_EVENT, handleAppCommand);
    return () => {
      window.removeEventListener(APP_COMMAND_EVENT, handleAppCommand);
    };
  }, [
    currentPath,
    handleBeginRenameSelectedEntry,
    handleClipboardSelectionCommand,
    handleCreateFolder,
    handleCreateTextFile,
    handleDeleteSelectedEntries,
    handleGoUpDoubleClick,
    handleOpenSelectedEntryInNewTab,
    handlePasteEntries,
    goBack,
    goForward,
    paneId,
    requestBreadcrumbInputFocus,
    resolveCreateCommandOptions,
    redoEntries,
    saveFolderViewStyle,
    undoEntries,
  ]);
  const { handlePanelScroll } = useFilesystemPanelLoadMore({
    panelRef: panelScrollRef,
    handlePanelListScroll,
    scheduleEntryWindowRecompute: isGridView ? scheduleGridWindowRecompute : scheduleEntryWindowRecompute,
    isEntryWindowingEnabled: isGridView ? isGridWindowingEnabled : isEntryWindowingEnabled,
    hasMoreEntries,
    isLoadingEntries,
    isLoadingMoreEntries,
    loadMoreEntries,
    isBrowsing,
    treeRowsCount: isGridView ? entries.length : treeRows.length,
    virtualEndIndex: isGridView ? gridVirtualEndIndex * gridColumns : virtualEndIndex,
  });
  const handleToggleThumbnailSize = useCallback(() => {
    const currentIndex = FILESYSTEM_THUMBNAIL_SIZE_STEPS.indexOf(thumbnailSizePxRef.current);
    const nextIndex = currentIndex >= 0
      ? (currentIndex + 1) % FILESYSTEM_THUMBNAIL_SIZE_STEPS.length
      : 0;
    const newSize = FILESYSTEM_THUMBNAIL_SIZE_STEPS[nextIndex];
    setThumbnailSizePx(newSize);
    saveFolderViewStyle(currentPath, viewType, newSize);
  }, [currentPath, viewType, saveFolderViewStyle]);
  const handleCtrlWheel = useCallback((event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    let newSize;
    setThumbnailSizePx((previousSize) => {
      const currentIndex = FILESYSTEM_THUMBNAIL_SIZE_STEPS.indexOf(previousSize);
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      const delta = event.deltaY < 0 ? 1 : -1;
      const nextIndex = Math.max(0, Math.min(FILESYSTEM_THUMBNAIL_SIZE_STEPS.length - 1, baseIndex + delta));
      newSize = FILESYSTEM_THUMBNAIL_SIZE_STEPS[nextIndex];
      return newSize;
    });
    saveFolderViewStyle(currentPath, viewType, newSize);
  }, [currentPath, viewType, saveFolderViewStyle]);
  const panelStyle = useMemo(() => ({
    "--entry-font-size": `var(${thumbnailSizePx <= 32 ? "--font-size-small" : "--font-size-base"})`,
    "--entry-thumbnail-size": `${thumbnailSizePx}px`,
    "--entry-row-height": `${entryRowHeightPx}px`,
  }), [entryRowHeightPx, thumbnailSizePx]);

  return <section
    ref={setPanelNodeRef}
    className={`${styles.panelContent} ${isPanelDropOver && isInternalDragActive ? styles.panelDropTarget : ""} ${isExternalDragOver ? styles.externalDropTarget : ""}`}
    style={panelStyle}
    aria-label="Filesystem panel"
    data-drop-destination-path={currentPath || undefined}
    onKeyDown={handlePanelKeyDown}
    onWheel={handleCtrlWheel}
  >
    <PanelHeader
      panelType={panelType}
      panelLabel={panelLabel}
      onPanelTypeChange={onPanelTypeChange}
    >
      <FilesystemStatusMessages
        isBrowsing={isBrowsing}
        isLoadingDrives={isLoadingDrives}
        isLoadingEntries={isLoadingEntries}
        isMovingEntry={isMovingEntry}
        isDeletingEntries={isDeletingEntries}
        isImportingExternal={isImportingExternal}
        error={error}
      />
      <div>
        <button
          type="button"
          className={styles.historyNavigationButton}
          onClick={goBack}
          title={HISTORY_BACK_BUTTON_TITLE}
          aria-label={HISTORY_BACK_BUTTON_TITLE}
          disabled={!canGoBack}
        >←</button>
        <button
          type="button"
          className={styles.historyNavigationButton}
          onClick={goForward}
          title={HISTORY_FORWARD_BUTTON_TITLE}
          aria-label={HISTORY_FORWARD_BUTTON_TITLE}
          disabled={!canGoForward}
        >→</button>
        <button
          type="button"
          className={styles.thumbnailSizeToggle}
          onClick={handleToggleThumbnailSize}
          title={THUMBNAIL_SIZE_TOGGLE_TITLE}
          aria-label={`Toggle icon and thumbnail size. Current: ${thumbnailSizePx}px`}
        >{thumbnailSizePx}px</button>
      </div>
    </PanelHeader>
    <div
      ref={panelScrollRef}
      className={shellStyles.panelBody}
      data-testid="filesystem-panel-scroll-container"
      data-panel-scroll="true"
      onClick={handlePanelBackgroundClick}
      onContextMenuCapture={handlePanelBackgroundContextMenu}
      onScroll={handlePanelScroll}
    >
      <FilesystemPanelListContent
        paneId={paneId}
        browse={{
          isBrowsing,
          isLoadingDrives,
          isLoadingEntries,
          error,
          isEntryOperationInProgress,
        }}
        drives={{
          items: drives,
          selectedPathSet,
          onSelect: setSelectedPath,
          onOpen: selectDrive,
        }}
        breadcrumbs={{
          currentPath,
          currentDrive,
          onSelect: handleBreadcrumbSelect,
          onPathSubmit: (path, options = {}) => {
            handleOpenFolderViaRecentSelection(path, options);
          },
          loadSubfoldersForPath,
          focusPathInputRequestKey: breadcrumbFocusRequestKey,
          activeDragPaths: effectiveActiveDragPaths,
          isMovingEntry,
          getDropIdForPath: dnd.getBreadcrumbDropId,
          workspaceFolderPathSet,
          recentFoldersEntries,
          isLoadingRecentFolders: recentFoldersLoading,
          onSelectRecentFolder: path => {
            handleOpenFolderViaRecentSelection(path);
          },
        }}
        windowing={{
          entryWindowAnchorRef,
          isEnabled: isEntryWindowingEnabled,
          topSpacerHeight,
          bottomSpacerHeight,
        }}
        entries={{
          rows: renderedRows,
          selectedEntryPaths,
          selectedEntryPathSet,
          activeDragPathSet: effectiveActiveDragPathSet,
          activeDropDestinationPath: effectiveActiveDropDestinationPath,
          renamingPath,
          thumbnailSrcByPath,
          onToggleDirectoryExpanded: toggleDirectoryExpanded,
          onEntryClick: handleEntryClick,
          onEntryDoubleClick: handleEntryDoubleClick,
          onEntryMiddleClick: handleEntryMiddleClick,
          onEntryContextMenu: handleEntryContextMenu,
          onEntryRenameSubmit: handleEntryRenameSubmit,
          onEntryRenameCancel: handleEntryRenameCancel,
        }}
        drag={{
          activeEntry: activeDragEntry,
          activeEntries: activeDragEntries,
          intent: dragIntent,
        }}
        viewType={viewType}
        grid={{
          entries: visibleGridEntries,
          selectedPathSet,
          thumbnailSrcByPath,
          workspaceFolderPathSet,
          columnCount: gridColumns,
          anchorRef: gridAnchorRef,
          topSpacerHeight: gridTopSpacerHeight,
          bottomSpacerHeight: gridBottomSpacerHeight,
          isWindowingEnabled: isGridWindowingEnabled,
          renamingPath,
          onEntryClick: handleEntryClick,
          onEntryDoubleClick: handleEntryDoubleClick,
          onEntryContextMenu: handleEntryContextMenu,
          onEntryRenameSubmit: handleEntryRenameSubmit,
          onEntryRenameCancel: handleEntryRenameCancel,
        }}
      />
    </div>
  </section>;
}

export default FilesystemPanel;
