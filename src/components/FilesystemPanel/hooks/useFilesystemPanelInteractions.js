import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePanelsDndHandlers } from "../../PanelsDndLayer";
import useFilesystemDnd from "./useFilesystemDnd";
import useExternalFilesystemDrag from "./useExternalFilesystemDrag";
import useExternalPathDrop from "../../hooks/useExternalPathDrop";
import { uniqueNonEmptyPaths } from "../../../utils/pathSelection";
import isEditableKeyboardTarget from "../../../utils/isEditableKeyboardTarget";
import { getParentDirectoryPath, isSamePath } from "../../../utils/pathWatch";
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

// The element the panel renders for an entry or a drive, if it renders one.
function findPathElement(panelElement, path) {
  return Array.from(panelElement.querySelectorAll("[data-context-id]"))
    .find((element) => element.dataset.contextId === path);
}

// The path `direction` steps from `fromPath`. Past either end it loops around, or gives "" when it
// doesn't wrap. From outside `paths` (nothing selected) it goes to the first path; a step back
// that wraps goes around to the last one instead.
function getLinearNeighbourPath(paths, fromPath, direction, wraps) {
  const index = paths.indexOf(fromPath);
  if (index < 0) return direction > 0 || !wraps ? paths[0] : paths.at(-1);
  if (wraps) return paths[(index + direction + paths.length) % paths.length];
  return paths[index + direction] ?? "";
}

function handlePanelNavigationCommand(event, {
  handleArrowKey,
  handleDeleteKeyPress,
  handleOpenSelectedEntry,
}) {
  switch (event.key) {
    case "ArrowDown":
    case "ArrowUp":
      event.preventDefault();
      handleArrowKey(event.key, event.shiftKey);
      return;
    case "ArrowRight":
    case "ArrowLeft":
      if (handleArrowKey(event.key, event.shiftKey)) event.preventDefault();
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
  selectionFocusPath = "",
  // Given only by a view that lays entries out in tiles (both grid views): (path, direction,
  // wraps) => the entry above or below `path`, or "".
  getVerticalNeighbourPath = undefined,
  // False where folders are cells that don't open in place (grid view): Right/Left then move.
  canOpenFoldersWithArrows = true,
  // True while pages of the folder are left to load: the last loaded entry isn't the last one yet.
  hasMoreEntries = false,
  // (path) => scrolls the view to where the entry is. A long list renders only a window of its rows
  // (useVirtualizedEntryWindow), so an entry outside it has no element to scroll into view.
  scrollToUnrenderedPath = undefined,
  drivePaths = [],
  treeRows = [],
  isBrowsing = false,
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
  onExpandDirectory = undefined,
  onOpenDrivePath = undefined,
  workspaceFolderPathSet = new Set(),
  openConfirm,
  pushNotification = undefined,
}) {
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
    if (isBrowsing) return treeData.entryPaths;
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
    onDropTransfer: runInternalDropTransfer,
  });

  const handleExternalDragStateChange = useCallback((dragState) => {
    if (!isBrowsing) {
      setExternalDropDestinationPath("");
      return;
    }
    const clientPosition = dragState?.clientPosition ?? null;
    if (dragState?.isInsidePanel !== true || !clientPosition) {
      setExternalDropDestinationPath("");
      return;
    }
    setExternalDropDestinationPath(resolveExternalDropDestinationFromPoint(clientPosition, currentPath));
  }, [currentPath, isBrowsing]);

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
    isEnabled: isBrowsing,
    onDropPaths: handleExternalDropPaths,
    onExternalDragStateChange: handleExternalDragStateChange,
  });

  useExternalFilesystemDrag({
    dragPaths: dnd.externalDragPaths,
    isEnabled: isBrowsing,
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

    const nextTarget = findPathElement(panelElement, entryPath);
    if (nextTarget) nextTarget.scrollIntoView?.({ block: "nearest" });
    else scrollToUnrenderedPath?.(entryPath);
  }, [panelRef, scrollToUnrenderedPath]);

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
  // Breadcrumbs and drive rows only know a folder path, not a listed entry.
  const handleFolderPathMiddleClick = useCallback((path, event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    openEntry({ path, is_dir: true }, {
      forceOpenInNewTab: true,
      isWorkspaceFolder: workspaceFolderPathSet.has(path),
    });
  }, [openEntry, workspaceFolderPathSet]);
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

  const beginRenameEntry = useCallback((path) => {
    if (!isBrowsing || !treeData.entryByPath[path]) return false;
    setRenamingPath(path);
    return true;
  }, [isBrowsing, treeData.entryByPath]);
  const handleBeginRenameSelectedEntry = useCallback(() => (
    selectedEntryPaths.length === 1 && beginRenameEntry(selectedEntryPaths[0])
  ), [beginRenameEntry, selectedEntryPaths]);

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
    if (!isBrowsing) return false;
    if (typeof createAction !== "function") return false;

    const overrideParentDir = typeof options?.parentDir === "string" ? options.parentDir : "";
    const overrideFolderPath = typeof options?.expandFolderPath === "string"
      ? options.expandFolderPath
      : "";
    const fallbackTarget = resolveCreateTarget();
    const parentDir = overrideParentDir || fallbackTarget.parentDir;
    const selectedFolderPath = overrideFolderPath || fallbackTarget.selectedFolderPath;
    if (!parentDir) return false;

    try {
      const createdEntry = await createAction(parentDir);
      const createdPath = typeof createdEntry?.path === "string" ? createdEntry.path : "";
      if (!createdPath) return false;

      // Opened only now, so the folder's listing (a first load or a re-list) has the new item and
      // the rename below can find it.
      if (selectedFolderPath) onExpandDirectory?.(selectedFolderPath);
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
    onExpandDirectory,
    pushNotification,
    resolveCreateTarget,
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
    // A rename still waiting for its item is kept only when the pane enters that item's folder,
    // so it can't open whenever the item shows up later (one created in a folder cell never
    // shows in grid view).
    setPendingRenamePath((pendingPath) => (
      isSamePath(getParentDirectoryPath(pendingPath), currentPath) ? pendingPath : ""
    ));
  }, [currentPath]);

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
    if (!isBrowsing || normalizedSelection.length === 0) return;

    const selectedEntries = normalizedSelection
      .map((path) => treeData.entryByPath[path])
      .filter(Boolean);
    const confirmMessage = selectedEntries.length === 1
      ? `Move "${selectedEntries[0].name}" to the Recycle Bin?`
      : `Move ${selectedEntries.length} selected items to the Recycle Bin?`;

    const shouldDelete = await openConfirm({
      title: "Delete selected items?",
      message: confirmMessage,
      tone: "warning",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
    });
    if (!shouldDelete) return;

    // The delete may wait its turn in the tab's queue; the selection clears at once.
    deleteEntries(normalizedSelection);
    clearSelectedEntries();
  }, [
    clearSelectedEntries,
    deleteEntries,
    isBrowsing,
    openConfirm,
    selectedEntryPaths,
    treeData.entryByPath,
  ]);
  // The entry the last arrow key moved the keyboard focus to while it had no element (outside a
  // long list's rendered window): it takes the focus once the view's jump renders it.
  const pendingFocusPathRef = useRef("");
  useLayoutEffect(() => {
    if (!pendingFocusPathRef.current) return;
    const pendingElement = findPathElement(panelRef.current, pendingFocusPathRef.current);
    if (!pendingElement) return;
    pendingFocusPathRef.current = "";
    pendingElement.focus({ preventScroll: true });
  });
  const moveSelectionTo = useCallback((nextPath, isExtendingRange) => {
    // Drives aren't entries: they are selected by path.
    const nextSelectedPaths = treeData.entryPathSet.has(nextPath)
      ? selectEntry(nextPath, { range: isExtendingRange, entryPaths: treeData.entryPaths })
      : setSelectedPath(nextPath);
    emitTabSelectedFiles(nextSelectedPaths);
    // In a list that has the keyboard focus, the focus follows the selection, so the keys keep
    // coming to that list. Left on the element it was on, it would drop to the document body once
    // that element left a long list's rendered window, and the keys would go to the pane under the
    // pointer. Keys that came here by the pointer leave the focus where it is, so the next ones
    // follow the pointer too.
    pendingFocusPathRef.current = "";
    if (panelRef.current.contains(document.activeElement)) {
      const nextElement = findPathElement(panelRef.current, nextPath);
      if (nextElement) nextElement.focus({ preventScroll: true });
      else pendingFocusPathRef.current = nextPath;
    }
    scrollPathIntoView(nextPath);
  }, [
    emitTabSelectedFiles,
    panelRef,
    scrollPathIntoView,
    selectEntry,
    setSelectedPath,
    treeData.entryPathSet,
    treeData.entryPaths,
  ]);

  // Up/Down step through the entry order, or by column in a tile layout. Left/Right open or close
  // the folder the keyboard is on (unless canOpenFoldersWithArrows is off); in a tile layout they
  // otherwise step through the reading order. False when the key did nothing, so the event is left
  // alone.
  const handleArrowKey = useCallback((key, extendSelection) => {
    const paths = keyboardNavigationPaths;
    if (paths.length === 0) return false;

    // The focus, not the last selected path: ranges are kept in entry order, so after Shift+Up that
    // path is the anchor, and every further Shift+Up would select the same range again.
    const referencePath = paths.includes(selectionFocusPath)
      ? selectionFocusPath
      : selectedPaths.findLast((path) => paths.includes(path)) ?? "";
    const isExtendingRange = extendSelection && treeData.entryPathSet.has(referencePath);
    const isTileLayout = Boolean(getVerticalNeighbourPath);
    const direction = key === "ArrowDown" || key === "ArrowRight" ? 1 : -1;

    if (key === "ArrowDown" || key === "ArrowUp") {
      // A Shift range stops at the first and the last entry. Plain arrows loop around once the
      // whole folder is loaded; until then they stop too, at the first and the last loaded entry.
      const wraps = !isExtendingRange && !hasMoreEntries;
      const nextPath = isTileLayout && referencePath
        ? getVerticalNeighbourPath(referencePath, direction, wraps)
        : getLinearNeighbourPath(paths, referencePath, direction, wraps);
      if (nextPath) moveSelectionTo(nextPath, isExtendingRange);
      return true;
    }

    const row = rowByPath[referencePath];
    const canOpenOrClose = canOpenFoldersWithArrows
      && row?.entry.is_dir
      && (direction > 0 ? !row.isExpanded : row.isExpanded);
    // Shift+Left/Right in a tile layout only extend the range.
    if (canOpenOrClose && !(isTileLayout && extendSelection)) {
      onToggleDirectoryExpanded?.(referencePath);
      return true;
    }
    if (!isTileLayout) return false;

    const nextPath = getLinearNeighbourPath(paths, referencePath, direction, false);
    if (!nextPath) return false;
    moveSelectionTo(nextPath, isExtendingRange);
    return true;
  }, [
    canOpenFoldersWithArrows,
    getVerticalNeighbourPath,
    hasMoreEntries,
    keyboardNavigationPaths,
    moveSelectionTo,
    onToggleDirectoryExpanded,
    rowByPath,
    selectedPaths,
    selectionFocusPath,
    treeData.entryPathSet,
  ]);

  // Several files all open; otherwise the last path opens (a folder is navigated into).
  const openEntryPaths = useCallback((paths) => {
    const files = paths
      .map(path => treeData.entryByPath[path])
      .filter(entry => entry && !entry.is_dir);
    if (files.length > 1) {
      files.forEach((entry) => {
        openEntry(entry, {
          isWorkspaceFolder: workspaceFolderPathSet.has(entry.path),
        });
      });
      return true;
    }

    const lastPath = paths.at(-1) ?? "";
    if (!isBrowsing && drivePaths.includes(lastPath)) {
      onOpenDrivePath?.(lastPath);
      return true;
    }

    const lastEntry = treeData.entryByPath[lastPath];
    if (!lastEntry) return false;

    openEntry(lastEntry, {
      isWorkspaceFolder: workspaceFolderPathSet.has(lastEntry.path),
    });
    return true;
  }, [
    drivePaths,
    isBrowsing,
    onOpenDrivePath,
    openEntry,
    treeData.entryByPath,
    workspaceFolderPathSet,
  ]);
  const handleOpenSelectedEntry = useCallback(
    () => openEntryPaths(selectedPaths),
    [openEntryPaths, selectedPaths],
  );

  const handleOpenSelectedEntryInNewTab = useCallback(() => {
    if (!isBrowsing) return false;
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
    if (isEditableKeyboardTarget(event.target)) return;
    if (hasCommandModifiers(event)) return;
    // Enter, arrows and Delete on any pane's header buttons and in the (portaled) search options
    // panel belong to those controls, not to the list of the pane under the pointer.
    if (event.target.closest?.("[data-pane-header], [data-search-options]")) return;

    handlePanelNavigationCommand(event, {
      handleArrowKey,
      handleDeleteKeyPress,
      handleOpenSelectedEntry,
    });
  }, [
    handleArrowKey,
    handleDeleteKeyPress,
    handleOpenSelectedEntry,
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
    handleFolderPathMiddleClick,
    handleEntryContextMenu,
    handlePanelBackgroundClick,
    handlePanelBackgroundContextMenu,
    beginRenameEntry,
    handleBeginRenameSelectedEntry,
    handleEntryRenameCancel,
    handleEntryRenameSubmit,
    handleCreateTextFile,
    handleCreateFolder,
    handleDeleteSelectedEntries,
    handlePanelKeyDown,
    openEntryPaths,
    handleOpenSelectedEntry,
    handleOpenSelectedEntryInNewTab,
    isExternalDragOver,
  };
}
