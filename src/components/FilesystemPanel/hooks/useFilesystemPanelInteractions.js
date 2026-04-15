import { useCallback, useEffect, useMemo, useState } from "react";
import { usePanelsDndHandlers } from "../../PanelsDndLayer";
import useFilesystemDnd from "./useFilesystemDnd";
import useExternalFilesystemDrag from "./useExternalFilesystemDrag";
import useExternalPathDrop from "../../hooks/useExternalPathDrop";
import { uniqueNonEmptyPaths } from "../../../utils/pathSelection";
import isEditableKeyboardTarget from "../../../utils/isEditableKeyboardTarget";
import { getParentDirectoryPath } from "../../../utils/pathWatch";
import { getNavigationErrorMessage } from "./filesystemNavigationUtils";
import {
  buildTreeData,
  resolveExternalDropDestinationFromPoint,
} from "../filesystemPanelUtils";

function getContextMenuBoundaryType(target) {
  if (!(target instanceof Element)) return "";
  return target.closest("[data-contextmenu-boundary]")?.dataset.contextmenuBoundary || "";
}

function hasCommandModifiers(event) {
  return event.metaKey || event.ctrlKey || event.altKey;
}

function handlePanelNavigationCommand(event, {
  handleDeleteKeyPress,
  handleExpandOrCollapseSelectedEntry,
  handleMoveSelectionBy,
  handleOpenSelectedEntry,
}) {
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      handleMoveSelectionBy(1, event.shiftKey);
      return;
    case "ArrowUp":
      event.preventDefault();
      handleMoveSelectionBy(-1, event.shiftKey);
      return;
    case "ArrowRight":
      if (handleExpandOrCollapseSelectedEntry(true)) event.preventDefault();
      return;
    case "ArrowLeft":
      if (handleExpandOrCollapseSelectedEntry(false)) event.preventDefault();
      return;
    case "Enter":
      if (handleOpenSelectedEntry()) event.preventDefault();
      return;
    case "Delete":
      handleDeleteKeyPress(event);
      return;
    default:
      return;
  }
}

export default function useFilesystemPanelInteractions({
  tabId = "",
  paneId = "",
  panelRef,
  currentPath = "",
  selectedPaths = [],
  drivePaths = [],
  treeRows = [],
  isBrowsing = false,
  isEntryOperationInProgress = false,
  isExternalDragEnabled = false,
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
  onEntryPathRenamed = undefined,
  onTabSelectedFilesChange,
  onDeleteShortcutCommand = undefined,
  onToggleDirectoryExpanded = undefined,
  onOpenDrivePath = undefined,
  onOpenUpEntry = undefined,
  workspaceFolderPathSet = new Set(),
  openConfirm,
  pushNotification = undefined,
}) {
  const upSelectionId = "__up__";
  const [externalDropDestinationPath, setExternalDropDestinationPath] = useState("");
  const [renamingPath, setRenamingPath] = useState("");
  const [pendingRenamePath, setPendingRenamePath] = useState("");
  const treeData = useMemo(() => buildTreeData(treeRows), [treeRows]);
  const selectedEntryPaths = useMemo(() => (
    selectedPaths.filter((path) => treeData.entryPathSet.has(path))
  ), [selectedPaths, treeData.entryPathSet]);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedEntryPathSet = useMemo(
    () => new Set(selectedEntryPaths),
    [selectedEntryPaths],
  );
  const rowByPath = useMemo(() => {
    const nextByPath = {};
    treeRows.forEach((row) => {
      if (!row?.entry?.path) return;
      nextByPath[row.entry.path] = row;
    });
    return nextByPath;
  }, [treeRows]);
  const keyboardNavigationPaths = useMemo(() => {
    if (isBrowsing) return [upSelectionId, ...treeData.entryPaths];
    return drivePaths.filter((path) => typeof path === "string" && path);
  }, [drivePaths, isBrowsing, treeData.entryPaths]);

  const runInternalDropTransfer = useCallback(async ({
    sourcePaths = [],
    destinationDir = "",
    shouldCopy = false,
  } = {}) => {
    const normalizedSourcePaths = uniqueNonEmptyPaths(sourcePaths);
    if (!destinationDir || normalizedSourcePaths.length === 0) return;

    if (shouldCopy) {
      await copyEntries(normalizedSourcePaths, destinationDir);
      return;
    }

    await moveEntries(normalizedSourcePaths, destinationDir);
  }, [copyEntries, moveEntries]);

  const runExternalDropTransfer = useCallback(async ({
    sourcePaths = [],
    destinationDir = "",
    shouldCopy = true,
  } = {}) => {
    const normalizedSourcePaths = uniqueNonEmptyPaths(sourcePaths);
    if (!destinationDir || normalizedSourcePaths.length === 0) return;

    if (shouldCopy) {
      await importExternalPaths(normalizedSourcePaths, destinationDir);
      return;
    }

    await moveEntries(normalizedSourcePaths, destinationDir);
  }, [importExternalPaths, moveEntries]);

  const dnd = useFilesystemDnd({
    paneId,
    entries: treeData.entries,
    entryParentByPath: treeData.entryParentByPath,
    selectedPaths: selectedEntryPaths,
    isMovingEntry: isEntryOperationInProgress,
    onDropTransfer: runInternalDropTransfer,
  });

  const handleExternalDragStateChange = useCallback((dragState) => {
    if (!isExternalDragEnabled) {
      setExternalDropDestinationPath("");
      return;
    }
    const clientPosition = dragState?.clientPosition ?? null;
    if (dragState?.isInsidePanel !== true || !clientPosition) {
      setExternalDropDestinationPath("");
      return;
    }
    setExternalDropDestinationPath(resolveExternalDropDestinationFromPoint(clientPosition, currentPath));
  }, [currentPath, isExternalDragEnabled]);

  const handleExternalDropPaths = useCallback(async (droppedPaths, context = {}) => {
    const destinationDir = resolveExternalDropDestinationFromPoint(
      context.clientPosition ?? null,
      currentPath,
    );
    const matchingInternalDragPaths = dnd.consumeMatchingExternalDragSourcePaths(droppedPaths);
    const dropEffect = typeof context.dropEffect === "string"
      ? context.dropEffect.toLowerCase()
      : "";
    const shouldCopyInternal = context.ctrlKey === true || dropEffect === "copy";
    const shouldCopyExternal = !(context.shiftKey === true || dropEffect === "move");
    setExternalDropDestinationPath("");
    if (matchingInternalDragPaths.length > 0) {
      await runInternalDropTransfer({
        sourcePaths: matchingInternalDragPaths,
        destinationDir,
        shouldCopy: shouldCopyInternal,
      });
      return;
    }
    await runExternalDropTransfer({
      sourcePaths: droppedPaths,
      destinationDir,
      shouldCopy: shouldCopyExternal,
    });
  }, [currentPath, dnd, runExternalDropTransfer, runInternalDropTransfer]);

  const { isExternalDragOver } = useExternalPathDrop({
    panelRef,
    isEnabled: isExternalDragEnabled,
    onDropPaths: handleExternalDropPaths,
    onExternalDragStateChange: handleExternalDragStateChange,
  });

  useExternalFilesystemDrag({
    dragPaths: dnd.externalDragPaths,
    isEnabled: isExternalDragEnabled,
    onExternalDragStart: dnd.markExternalDragStart,
    onExternalDragError: dnd.clearExternalDragStart,
  });

  usePanelsDndHandlers({
    onDragStart: dnd.handleDragStart,
    onDragOver: dnd.handleDragOver,
    onDragEnd: dnd.handleDragEnd,
    onDragCancel: dnd.handleDragCancel,
  });

  const internalActiveDragPathSet = useMemo(
    () => new Set(dnd.activeDragPaths),
    [dnd.activeDragPaths],
  );
  const hasExternalDropDestination = Boolean(externalDropDestinationPath);
  const effectiveActiveDragPaths = hasExternalDropDestination
    ? ["__external__"]
    : dnd.activeDragPaths;
  const effectiveActiveDragPathSet = useMemo(
    () => new Set(effectiveActiveDragPaths),
    [effectiveActiveDragPaths],
  );
  const effectiveActiveDropDestinationPath =
    externalDropDestinationPath || dnd.activeDropDestinationPath;
  const isInternalDragActive = dnd.activeDragPaths.length > 0;
  const dragIntent = dnd.isCopyIntent ? "copy" : "move";
  const activeDragEntries = useMemo(() => (
    treeData.entries.filter((entry) => internalActiveDragPathSet.has(entry.path))
  ), [internalActiveDragPathSet, treeData.entries]);
  const activeDragEntry = activeDragEntries[0] ?? null;

  const emitTabSelectedFiles = useCallback((nextSelectedPaths, options = {}) => {
    if (!tabId) return;
    const normalizedPaths = uniqueNonEmptyPaths(nextSelectedPaths);
    const selectedEntryKinds = {};
    normalizedPaths.forEach((path) => {
      const entry = treeData.entryByPath[path];
      if (!entry) return;
      selectedEntryKinds[path] = entry.is_dir ? "folder" : "file";
    });
    const previewOpenMode = options?.previewOpenMode === "pinned"
      ? "pinned"
      : "ephemeral";
    onTabSelectedFilesChange?.({
      selectedPaths: normalizedPaths,
      selectedEntryKinds,
      previewOpenMode,
    });
  }, [onTabSelectedFilesChange, tabId, treeData.entryByPath]);
  const clearSelectedEntries = useCallback(() => {
    setSelectedPath("");
    emitTabSelectedFiles([]);
  }, [emitTabSelectedFiles, setSelectedPath]);
  const scrollPathIntoView = useCallback((entryPath) => {
    const panelElement = panelRef?.current;
    if (!panelElement || !entryPath) return;

    const nextTarget = Array.from(panelElement.querySelectorAll("[data-context-id]"))
      .find((element) => element.dataset.contextId === entryPath);
    nextTarget?.scrollIntoView?.({ block: "nearest" });
  }, [panelRef]);

  const handleEntryClick = useCallback((entryPath, event) => {
    const nextSelectedEntryPaths = selectEntry(entryPath, {
      additive: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
      entryPaths: treeData.entryPaths,
    });
    emitTabSelectedFiles(nextSelectedEntryPaths);
  }, [emitTabSelectedFiles, selectEntry, treeData.entryPaths]);

  const handleEntryDoubleClick = useCallback((entry, event) => {
    const forceOpenInNewTab = Boolean(entry?.is_dir && event?.ctrlKey);
    openEntry(entry, {
      forceOpenInNewTab,
      isWorkspaceFolder: workspaceFolderPathSet.has(entry.path),
    });
  }, [openEntry, workspaceFolderPathSet]);

  const handleEntryMiddleClick = useCallback((entry, event) => {
    if (!entry || event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();

    if (!entry.is_dir) {
      const nextSelectedEntryPaths = selectEntry(entry.path, {
        entryPaths: treeData.entryPaths,
      });
      emitTabSelectedFiles(nextSelectedEntryPaths, {
        previewOpenMode: "pinned",
      });
      return;
    }

    openEntry(entry, {
      forceOpenInNewTab: true,
      isWorkspaceFolder: workspaceFolderPathSet.has(entry.path),
    });
  }, [emitTabSelectedFiles, openEntry, selectEntry, treeData.entryPaths, workspaceFolderPathSet]);
  const handleEntryContextMenu = useCallback((entryPath) => {
    if (selectedEntryPathSet.has(entryPath)) return;
    const nextSelectedEntryPaths = selectEntry(entryPath, {
      entryPaths: treeData.entryPaths,
    });
    emitTabSelectedFiles(nextSelectedEntryPaths);
  }, [emitTabSelectedFiles, selectEntry, selectedEntryPathSet, treeData.entryPaths]);
  const handlePanelBackgroundClick = useCallback((event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const boundaryType = getContextMenuBoundaryType(event.target);
    if (boundaryType && boundaryType !== "panel") return;
    clearSelectedEntries();
  }, [clearSelectedEntries]);
  const handlePanelBackgroundContextMenu = useCallback((event) => {
    const boundaryType = getContextMenuBoundaryType(event.target);
    if (boundaryType && boundaryType !== "panel") return;
    clearSelectedEntries();
  }, [clearSelectedEntries]);

  const handleBeginRenameSelectedEntry = useCallback(() => {
    if (!isBrowsing || isEntryOperationInProgress) return false;
    if (selectedEntryPaths.length !== 1) return false;
    const selectedPath = selectedEntryPaths[0];
    const selectedEntry = treeData.entryByPath[selectedPath];
    if (!selectedEntry) return false;
    setRenamingPath(selectedPath);
    return true;
  }, [
    isBrowsing,
    isEntryOperationInProgress,
    selectedEntryPaths,
    treeData.entryByPath,
  ]);

  const handleEntryRenameCancel = useCallback((entryPath) => {
    if (entryPath !== renamingPath) return;
    setRenamingPath("");
  }, [renamingPath]);

  const handleEntryRenameSubmit = useCallback(async (entryPath, nextName) => {
    if (entryPath !== renamingPath) return;

    const targetEntry = treeData.entryByPath[entryPath];
    if (!targetEntry) {
      setRenamingPath("");
      return;
    }

    const normalizedName = nextName.trim();
    if (!normalizedName || normalizedName === targetEntry.name) {
      setRenamingPath("");
      return;
    }

    try {
      const renameResult = await renameEntry(entryPath, normalizedName);
      if (renameResult?.adjusted && renameResult?.name && renameResult.name !== normalizedName) {
        pushNotification?.({
          title: "Name adjusted",
          message: `Saved as "${renameResult.name}" because "${normalizedName}" already exists.`,
          tone: "warning",
        });
      }
      onEntryPathRenamed?.(entryPath, renameResult.path);
      emitTabSelectedFiles([renameResult.path]);
    } catch (renameError) {
      pushNotification?.({
        title: "Rename failed",
        message: getNavigationErrorMessage(renameError, "Failed to rename item."),
        tone: "error",
      });
    } finally {
      setRenamingPath("");
    }
  }, [
    emitTabSelectedFiles,
    onEntryPathRenamed,
    pushNotification,
    renameEntry,
    renamingPath,
    treeData.entryByPath,
  ]);

  const beginRenameForPath = useCallback((entryPath) => {
    if (!entryPath) return;
    if (treeData.entryByPath[entryPath]) {
      setPendingRenamePath("");
      setRenamingPath(entryPath);
      scrollPathIntoView(entryPath);
      return;
    }
    setPendingRenamePath(entryPath);
  }, [scrollPathIntoView, treeData.entryByPath]);

  const resolveCreateTarget = useCallback(() => {
    const selectedPath = selectedEntryPaths[0];
    const selectedEntry = treeData.entryByPath[selectedPath];
    if (!selectedEntry) {
      return {
        parentDir: currentPath,
        selectedFolderPath: "",
      };
    }

    if (selectedEntry.is_dir) {
      return {
        parentDir: selectedEntry.path,
        selectedFolderPath: selectedEntry.path,
      };
    }

    return {
      parentDir: getParentDirectoryPath(selectedEntry.path) || currentPath,
      selectedFolderPath: "",
    };
  }, [currentPath, selectedEntryPaths, treeData.entryByPath]);

  const createItemAndRename = useCallback(async (
    createAction,
    createErrorTitle,
    options = {},
  ) => {
    if (!isBrowsing || isEntryOperationInProgress) return false;
    if (typeof createAction !== "function") return false;

    const overrideParentDir = typeof options?.parentDir === "string" ? options.parentDir : "";
    const overrideFolderPath = typeof options?.expandFolderPath === "string"
      ? options.expandFolderPath
      : "";
    const fallbackTarget = resolveCreateTarget();
    const parentDir = overrideParentDir || fallbackTarget.parentDir;
    const selectedFolderPath = overrideFolderPath || fallbackTarget.selectedFolderPath;
    if (!parentDir) return false;

    const selectedFolderRow = selectedFolderPath ? rowByPath[selectedFolderPath] : null;
    if (selectedFolderPath && selectedFolderRow && !selectedFolderRow.isExpanded) {
      onToggleDirectoryExpanded?.(selectedFolderPath);
    }

    try {
      const createdEntry = await createAction(parentDir);
      const createdPath = typeof createdEntry?.path === "string" ? createdEntry.path : "";
      if (!createdPath) return false;

      const nextSelectedPaths = setSelectedPath(createdPath);
      emitTabSelectedFiles(nextSelectedPaths);
      beginRenameForPath(createdPath);
      return true;
    } catch (createError) {
      pushNotification?.({
        title: createErrorTitle,
        message: getNavigationErrorMessage(createError, "Operation failed."),
        tone: "error",
      });
      return false;
    }
  }, [
    beginRenameForPath,
    emitTabSelectedFiles,
    isBrowsing,
    isEntryOperationInProgress,
    onToggleDirectoryExpanded,
    pushNotification,
    resolveCreateTarget,
    rowByPath,
    setSelectedPath,
  ]);

  const handleCreateFolder = useCallback(async (options = {}) => (
    createItemAndRename(createFolder, "Create folder failed", options)
  ), [createFolder, createItemAndRename]);

  const handleCreateTextFile = useCallback(async (options = {}) => (
    createItemAndRename(createTextFile, "Create file failed", options)
  ), [createItemAndRename, createTextFile]);

  useEffect(() => {
    setExternalDropDestinationPath("");
  }, [currentPath]);

  useEffect(() => {
    if (!isExternalDragEnabled) setExternalDropDestinationPath("");
  }, [isExternalDragEnabled]);

  useEffect(() => {
    if (renamingPath && !treeData.entryByPath[renamingPath]) setRenamingPath("");
  }, [renamingPath, treeData.entryByPath]);

  useEffect(() => {
    if (!pendingRenamePath) return;
    if (!treeData.entryByPath[pendingRenamePath]) return;
    setRenamingPath(pendingRenamePath);
    setPendingRenamePath("");
    scrollPathIntoView(pendingRenamePath);
  }, [pendingRenamePath, scrollPathIntoView, treeData.entryByPath]);

  const handleDeleteSelectedEntries = useCallback(async () => {
    const normalizedSelection = uniqueNonEmptyPaths(selectedEntryPaths);
    if (!isBrowsing || normalizedSelection.length === 0 || isEntryOperationInProgress) return;

    const selectedEntries = normalizedSelection
      .map((path) => treeData.entryByPath[path])
      .filter(Boolean);
    const confirmMessage = selectedEntries.length === 1
      ? `Delete "${selectedEntries[0].name}" permanently?`
      : `Delete ${selectedEntries.length} selected items permanently?`;

    const shouldDelete = await openConfirm({
      title: "Delete selected items?",
      message: confirmMessage,
      tone: "warning",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!shouldDelete) return;

    try {
      await deleteEntries(normalizedSelection);
      emitTabSelectedFiles([]);
    } catch {
      // The hook surfaces user-facing errors via status messages.
    }
  }, [
    deleteEntries,
    emitTabSelectedFiles,
    isBrowsing,
    isEntryOperationInProgress,
    openConfirm,
    selectedEntryPaths,
    treeData.entryByPath,
  ]);
  const handleMoveSelectionBy = useCallback((direction, extendSelection = false) => {
    const navigationPaths = keyboardNavigationPaths;
    if (!Array.isArray(navigationPaths) || navigationPaths.length === 0) return;

    let currentReferencePath = "";
    for (let index = selectedPaths.length - 1; index >= 0; index -= 1) {
      const selectedPath = selectedPaths[index];
      if (navigationPaths.includes(selectedPath)) {
        currentReferencePath = selectedPath;
        break;
      }
    }

    const currentIndex = navigationPaths.indexOf(currentReferencePath);
    let nextIndex;
    if (currentIndex < 0) {
      nextIndex = direction > 0 ? 0 : navigationPaths.length - 1;
    } else {
      nextIndex = (currentIndex + direction + navigationPaths.length) % navigationPaths.length;
    }
    const nextPath = navigationPaths[nextIndex];
    const nextIsTreeEntry = treeData.entryPathSet.has(nextPath);
    const currentIsTreeEntry = treeData.entryPathSet.has(currentReferencePath);

    let nextSelectedPaths = [];
    if (extendSelection && currentIsTreeEntry && nextIsTreeEntry) {
      nextSelectedPaths = selectEntry(nextPath, {
        range: true,
        entryPaths: treeData.entryPaths,
      });
    } else if (nextIsTreeEntry) {
      nextSelectedPaths = selectEntry(nextPath, {
        entryPaths: treeData.entryPaths,
      });
    } else {
      nextSelectedPaths = setSelectedPath(nextPath);
    }

    emitTabSelectedFiles(nextSelectedPaths);
    scrollPathIntoView(nextPath);
  }, [
    emitTabSelectedFiles,
    keyboardNavigationPaths,
    scrollPathIntoView,
    selectEntry,
    selectedPaths,
    setSelectedPath,
    treeData.entryPathSet,
    treeData.entryPaths,
  ]);

  const handleExpandOrCollapseSelectedEntry = useCallback((expand) => {
    const selectedPath = selectedPaths.at(-1) ?? "";
    const selectedRow = rowByPath[selectedPath];
    if (!selectedRow?.entry?.is_dir) return false;
    if (expand && selectedRow.isExpanded) return false;
    if (!expand && !selectedRow.isExpanded) return false;
    onToggleDirectoryExpanded?.(selectedPath);
    return true;
  }, [onToggleDirectoryExpanded, rowByPath, selectedPaths]);

  const handleOpenSelectedEntry = useCallback(() => {
    if (selectedPaths.length > 1) {
      const selectedFiles = selectedEntryPaths
        .map(path => treeData.entryByPath[path])
        .filter(entry => entry && !entry.is_dir);
      if (selectedFiles.length > 1) {
        selectedFiles.forEach((entry) => {
          openEntry(entry, {
            isWorkspaceFolder: workspaceFolderPathSet.has(entry.path),
          });
        });
        return true;
      }
    }

    const selectedPath = selectedPaths.at(-1) ?? "";
    if (selectedPath === upSelectionId) {
      onOpenUpEntry?.();
      return true;
    }

    if (!isBrowsing && drivePaths.includes(selectedPath)) {
      onOpenDrivePath?.(selectedPath);
      return true;
    }

    const selectedEntry = treeData.entryByPath[selectedPath];
    if (!selectedEntry) return false;

    openEntry(selectedEntry, {
      isWorkspaceFolder: workspaceFolderPathSet.has(selectedEntry.path),
    });
    return true;
  }, [
    drivePaths,
    isBrowsing,
    onOpenDrivePath,
    onOpenUpEntry,
    openEntry,
    selectedEntryPaths,
    selectedPaths,
    treeData.entryByPath,
    upSelectionId,
    workspaceFolderPathSet,
  ]);

  const handleOpenSelectedEntryInNewTab = useCallback(() => {
    if (!isBrowsing || isEntryOperationInProgress) return false;
    if (selectedEntryPaths.length !== 1) return false;

    const selectedPath = selectedEntryPaths[0];
    const selectedEntry = treeData.entryByPath[selectedPath];
    if (!selectedEntry?.is_dir) return false;

    openEntry(selectedEntry, {
      forceOpenInNewTab: true,
      isWorkspaceFolder: workspaceFolderPathSet.has(selectedEntry.path),
    });
    return true;
  }, [
    isBrowsing,
    isEntryOperationInProgress,
    openEntry,
    selectedEntryPaths,
    treeData.entryByPath,
    workspaceFolderPathSet,
  ]);

  const handleDeleteKeyPress = useCallback((event) => {
    if (!isBrowsing || selectedEntryPaths.length === 0) return;
    event.preventDefault();
    if (onDeleteShortcutCommand) onDeleteShortcutCommand();
    else handleDeleteSelectedEntries();
  }, [handleDeleteSelectedEntries, isBrowsing, onDeleteShortcutCommand, selectedEntryPaths.length]);

  const handlePanelKeyDown = useCallback((event) => {
    if (event.defaultPrevented || event.repeat) return;
    if (isEntryOperationInProgress) return;
    if (isEditableKeyboardTarget(event.target)) return;
    if (hasCommandModifiers(event)) return;

    handlePanelNavigationCommand(event, {
      handleDeleteKeyPress,
      handleExpandOrCollapseSelectedEntry,
      handleMoveSelectionBy,
      handleOpenSelectedEntry,
    });
  }, [
    handleDeleteKeyPress,
    handleExpandOrCollapseSelectedEntry,
    handleMoveSelectionBy,
    handleOpenSelectedEntry,
    isEntryOperationInProgress,
  ]);

  return {
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
    handleEntryRenameCancel,
    handleEntryRenameSubmit,
    handleCreateTextFile,
    handleCreateFolder,
    handleDeleteSelectedEntries,
    handlePanelKeyDown,
    handleOpenSelectedEntryInNewTab,
    isExternalDragOver,
  };
}
