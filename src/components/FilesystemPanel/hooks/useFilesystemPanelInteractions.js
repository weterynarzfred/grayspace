import { useCallback, useEffect, useMemo, useState } from "react";
import { usePanelsDndHandlers } from "../../PanelsDndLayer";
import useFilesystemDnd from "./useFilesystemDnd";
import useExternalFilesystemDrag from "./useExternalFilesystemDrag";
import useExternalPathDrop from "../../hooks/useExternalPathDrop";
import { uniqueNonEmptyPaths } from "../../../utils/pathSelection";
import isEditableKeyboardTarget from "../../../utils/isEditableKeyboardTarget";
import {
  buildTreeData,
  resolveExternalDropDestinationFromPoint,
} from "../filesystemPanelUtils";

export default function useFilesystemPanelInteractions({
  tabId = "",
  paneId = "",
  panelRef,
  currentPath = "",
  selectedPaths = [],
  treeRows = [],
  isBrowsing = false,
  isEntryOperationInProgress = false,
  isExternalDragEnabled = false,
  selectEntry,
  openEntry,
  moveEntries,
  copyEntries,
  importExternalPaths,
  deleteEntries,
  renameEntry,
  onTabSelectedFilesChange,
  workspaceFolderPathSet = new Set(),
  openConfirm,
}) {
  const [externalDropDestinationPath, setExternalDropDestinationPath] = useState("");
  const [renamingPath, setRenamingPath] = useState("");
  const treeData = useMemo(() => buildTreeData(treeRows), [treeRows]);
  const selectedEntryPaths = useMemo(() => (
    selectedPaths.filter((path) => treeData.entryPathSet.has(path))
  ), [selectedPaths, treeData.entryPathSet]);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedEntryPathSet = useMemo(
    () => new Set(selectedEntryPaths),
    [selectedEntryPaths],
  );

  const dnd = useFilesystemDnd({
    paneId,
    entries: treeData.entries,
    entryParentByPath: treeData.entryParentByPath,
    selectedPaths: selectedEntryPaths,
    isMovingEntry: isEntryOperationInProgress,
    moveEntries,
    copyEntries,
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
    setExternalDropDestinationPath("");
    if (matchingInternalDragPaths.length > 0) {
      await moveEntries(matchingInternalDragPaths, destinationDir);
      return;
    }
    await importExternalPaths(droppedPaths, destinationDir);
  }, [currentPath, dnd, importExternalPaths, moveEntries]);

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
  const activeDragEntries = useMemo(() => (
    treeData.entries.filter((entry) => internalActiveDragPathSet.has(entry.path))
  ), [internalActiveDragPathSet, treeData.entries]);
  const activeDragEntry = activeDragEntries[0] ?? null;

  const emitTabSelectedFiles = useCallback((nextSelectedPaths) => {
    if (!tabId) return;
    onTabSelectedFilesChange?.({
      selectedPaths: uniqueNonEmptyPaths(nextSelectedPaths),
    });
  }, [onTabSelectedFilesChange, tabId]);

  const handleEntryClick = useCallback((entryPath, event) => {
    const nextSelectedEntryPaths = selectEntry(entryPath, {
      additive: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
      entryPaths: treeData.entryPaths,
    });
    emitTabSelectedFiles(nextSelectedEntryPaths);
  }, [emitTabSelectedFiles, selectEntry, treeData.entryPaths]);

  const handleEntryDoubleClick = useCallback((entry) => {
    openEntry(entry, {
      isWorkspaceFolder: workspaceFolderPathSet.has(entry.path),
    });
  }, [openEntry, workspaceFolderPathSet]);

  const handleEntryMiddleClick = useCallback((entry, event) => {
    if (!entry?.is_dir || event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    openEntry(entry, {
      forceOpenInNewTab: true,
      isWorkspaceFolder: workspaceFolderPathSet.has(entry.path),
    });
  }, [openEntry, workspaceFolderPathSet]);

  const handleBeginRenameSelectedEntry = useCallback(() => {
    if (!isBrowsing || isEntryOperationInProgress) return false;
    if (selectedEntryPaths.length !== 1) return false;
    const selectedPath = selectedEntryPaths[0];
    const selectedEntry = treeData.entryByPath[selectedPath];
    if (!selectedEntry || selectedEntry.is_dir) return false;
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
    if (!targetEntry || targetEntry.is_dir) {
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
        console.log(
          `[filesystem-rename] Requested "${normalizedName}", resolved to "${renameResult.name}".`,
        );
      }
      emitTabSelectedFiles([renameResult.path]);
    } catch (renameError) {
      console.error("[filesystem-rename] Failed to rename item.", renameError);
    } finally {
      setRenamingPath("");
    }
  }, [
    emitTabSelectedFiles,
    renameEntry,
    renamingPath,
    treeData.entryByPath,
  ]);

  useEffect(() => {
    setExternalDropDestinationPath("");
  }, [currentPath]);

  useEffect(() => {
    if (!isExternalDragEnabled) setExternalDropDestinationPath("");
  }, [isExternalDragEnabled]);

  useEffect(() => {
    if (renamingPath && !treeData.entryByPath[renamingPath]) setRenamingPath("");
  }, [renamingPath, treeData.entryByPath]);

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
      autoOpen: true,
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

  const handlePanelKeyDown = useCallback((event) => {
    if (event.key !== "Delete") return;
    if (event.defaultPrevented || event.repeat) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditableKeyboardTarget(event.target)) return;
    if (!isBrowsing || isEntryOperationInProgress || selectedEntryPaths.length === 0) return;

    event.preventDefault();
    void handleDeleteSelectedEntries();
  }, [
    handleDeleteSelectedEntries,
    isBrowsing,
    isEntryOperationInProgress,
    selectedEntryPaths.length,
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
    renamingPath,
    handleEntryClick,
    handleEntryDoubleClick,
    handleEntryMiddleClick,
    handleBeginRenameSelectedEntry,
    handleEntryRenameCancel,
    handleEntryRenameSubmit,
    handlePanelKeyDown,
    isExternalDragOver,
  };
}
