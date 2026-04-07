import { useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PanelHeader from "../PanelHeader";
import { buildBreadcrumbs } from "./Breadcrumbs";
import FilesystemPanelListContent from "./FilesystemPanelListContent";
import FilesystemStatusMessages from "./FilesystemStatusMessages";
import {
  FILESYSTEM_THUMBNAIL_SIZE_STEPS,
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
import styles from "./FilesystemPanel.module.scss";
import shellStyles from "../PanelShell.module.scss";

const UP_ENTRY_SELECTION_ID = "__up__";
const ENTRY_WINDOWING_THRESHOLD = 200;
const THUMBNAIL_SIZE_TOGGLE_TITLE = "Toggle icon/thumbnail size";
const NON_ENTRY_SELECTION_IDS = new Set([UP_ENTRY_SELECTION_ID]);

function FilesystemPanel({
  tabId = "",
  paneId = "",
  panelType = "Filesystem",
  tabWorkspaceRoot = "",
  onPanelTypeChange = undefined,
  onCurrentPathChange = undefined,
  onFilesystemStateChange = undefined,
  onTabSelectedFilesChange = undefined,
  filesystemState = undefined,
}) {
  const panelRef = useRef(null);
  const panelScrollRef = useRef(null);
  const entryWindowAnchorRef = useRef(null);
  const onCurrentPathChangeRef = useRef(onCurrentPathChange);
  const initialFilesystemStateRef = useRef(normalizeFilesystemPaneState(filesystemState));
  const [expandedPaths, setExpandedPaths] = useState(initialFilesystemStateRef.current.expandedPaths);
  const [thumbnailSizePx, setThumbnailSizePx] = useState(
    initialFilesystemStateRef.current.thumbnailSizePx,
  );
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
    isMovingEntry,
    isDeletingEntries,
    isImportingExternal,
    error,
    setSelectedPath,
    selectDrive,
    navigateToPath,
    loadMoreEntries,
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
  const { handlePanelListScroll } = useFilesystemStatePersistence({
    tabId,
    paneId,
    onFilesystemStateChange,
    panelListRef: panelScrollRef,
    initialFilesystemState: initialFilesystemStateRef.current,
    currentDrive,
    currentPath,
    selectedPaths,
    expandedPaths,
    thumbnailSizePx,
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
  const { thumbnailSrcByPath } = useFilesystemThumbnails({
    currentPath,
    visibleEntries,
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
    onOpenUpEntry: () => {
      void handleGoUpDoubleClick();
    },
    workspaceFolderPathSet,
    openConfirm,
    pushNotification,
  });
  const upDestinationPath = breadcrumbs.length > 2 ? breadcrumbs[breadcrumbs.length - 2].path : "";
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
    },
  });
  const setPanelNodeRef = useCallback((node) => {
    panelRef.current = node;
    setPanelDropNodeRef(node);
  }, [setPanelDropNodeRef]);
  const isPanelActive = useCallback(() => {
    const paneViewport = panelRef.current?.closest("[data-pane-active]");
    if (!paneViewport) return panelRef.current?.contains(document.activeElement);
    return paneViewport.getAttribute("data-pane-active") === "true";
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
    const contextSelectedPaths = uniqueNonEmptyPaths(commandContext?.selectedPaths)
      .filter(path => !NON_ENTRY_SELECTION_IDS.has(path));
    if (contextSelectedPaths.length > 0) return contextSelectedPaths;
    return selectedEntryPaths;
  }, [selectedEntryPaths]);
  const handleClipboardSelectionCommand = useCallback((mode, commandContext = {}) => {
    if (!isBrowsing || isEntryOperationInProgress) return false;
    const selectedCommandPaths = resolveCommandSelectedEntryPaths(commandContext);
    if (selectedCommandPaths.length === 0) return false;

    setFilesystemClipboardState(mode, selectedCommandPaths);
    void writeFilesystemClipboard(selectedCommandPaths, mode);
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
    if (!tabWorkspaceRoot) return true;
    return isPathInsideRoot(nextPath, tabWorkspaceRoot);
  }, [tabWorkspaceRoot]);
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
  const handleGoUpDoubleClick = useCallback(async () => {
    if (!await confirmWorkspaceExitIfNeeded(upDestinationPath)) return;
    navigateToPath(upDestinationPath);
  }, [confirmWorkspaceExitIfNeeded, navigateToPath, upDestinationPath]);

  useEffect(() => {
    onCurrentPathChangeRef.current = onCurrentPathChange;
  }, [onCurrentPathChange]);

  useEffect(() => {
    onCurrentPathChangeRef.current?.(currentPath);
  }, [currentPath]);

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
        void undoEntries();
      } else {
        void redoEntries();
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
  useEffect(() => {
    const handleAppCommand = (event) => {
      const detail = event?.detail ?? {};
      const { commandId = "", context = {} } = detail;
      if (!commandId) return;

      const targetPaneId = context?.targetPaneId || context?.activePaneId || "";
      if (targetPaneId && targetPaneId !== paneId) return;

      if (commandId === COMMAND_IDS.FILESYSTEM_RENAME_SELECTED) {
        handleBeginRenameSelectedEntry();
        return;
      }
      if (commandId === COMMAND_IDS.FILESYSTEM_COPY) {
        handleClipboardSelectionCommand("copy", context);
        return;
      }
      if (commandId === COMMAND_IDS.FILESYSTEM_CUT) {
        handleClipboardSelectionCommand("cut", context);
        return;
      }
      if (commandId === COMMAND_IDS.FILESYSTEM_PASTE) {
        void handlePasteEntries(context);
        return;
      }
      if (commandId === COMMAND_IDS.FILESYSTEM_CREATE_TEXT_FILE) {
        void handleCreateTextFile(resolveCreateCommandOptions(context));
        return;
      }
      if (commandId === COMMAND_IDS.FILESYSTEM_CREATE_FOLDER) {
        void handleCreateFolder(resolveCreateCommandOptions(context));
        return;
      }
      if (commandId === COMMAND_IDS.FILESYSTEM_DELETE_SELECTED) {
        void handleDeleteSelectedEntries();
        return;
      }
      if (commandId === COMMAND_IDS.FILESYSTEM_UNDO) {
        void undoEntries();
        return;
      }
      if (commandId === COMMAND_IDS.FILESYSTEM_REDO) {
        void redoEntries();
        return;
      }
      if (commandId === COMMAND_IDS.FILESYSTEM_OPEN_SELECTED_FOLDER_IN_NEW_TAB) {
        handleOpenSelectedEntryInNewTab();
        return;
      }
      if (commandId === COMMAND_IDS.FILESYSTEM_GO_UP) {
        void handleGoUpDoubleClick();
      }
    };

    window.addEventListener(APP_COMMAND_EVENT, handleAppCommand);
    return () => {
      window.removeEventListener(APP_COMMAND_EVENT, handleAppCommand);
    };
  }, [
    handleBeginRenameSelectedEntry,
    handleClipboardSelectionCommand,
    handleCreateFolder,
    handleCreateTextFile,
    handleDeleteSelectedEntries,
    handleGoUpDoubleClick,
    handleOpenSelectedEntryInNewTab,
    handlePasteEntries,
    paneId,
    resolveCreateCommandOptions,
    redoEntries,
    undoEntries,
  ]);
  const { handlePanelScroll } = useFilesystemPanelLoadMore({
    panelRef: panelScrollRef,
    handlePanelListScroll,
    scheduleEntryWindowRecompute,
    isEntryWindowingEnabled,
    hasMoreEntries,
    isLoadingEntries,
    isLoadingMoreEntries,
    loadMoreEntries,
    isBrowsing,
    treeRowsCount: treeRows.length,
    virtualEndIndex,
  });
  const handleToggleThumbnailSize = useCallback(() => {
    setThumbnailSizePx((previousSize) => {
      const currentIndex = FILESYSTEM_THUMBNAIL_SIZE_STEPS.indexOf(previousSize);
      const nextIndex = currentIndex >= 0
        ? (currentIndex + 1) % FILESYSTEM_THUMBNAIL_SIZE_STEPS.length
        : 0;
      return FILESYSTEM_THUMBNAIL_SIZE_STEPS[nextIndex];
    });
  }, []);
  const panelStyle = useMemo(() => ({
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
  >
    <PanelHeader
      panelType={panelType}
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
      <button
        type="button"
        className={styles.thumbnailSizeToggle}
        onClick={handleToggleThumbnailSize}
        title={THUMBNAIL_SIZE_TOGGLE_TITLE}
        aria-label={`Toggle icon and thumbnail size. Current: ${thumbnailSizePx}px`}
      >{thumbnailSizePx}px</button>
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
          activeDragPaths: effectiveActiveDragPaths,
          isMovingEntry,
          getDropIdForPath: dnd.getBreadcrumbDropId,
          workspaceFolderPathSet,
        }}
        upEntry={{
          destinationPath: upDestinationPath,
          isSelected: selectedPathSet.has(UP_ENTRY_SELECTION_ID),
          onSelect: () => setSelectedPath(UP_ENTRY_SELECTION_ID),
          onOpen: handleGoUpDoubleClick,
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
      />
    </div>
  </section>;
}

export default FilesystemPanel;
