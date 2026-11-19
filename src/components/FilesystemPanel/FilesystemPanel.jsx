import { useDroppable } from "@dnd-kit/core";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PanelHeader from "../PanelHeader";
import { buildBreadcrumbs } from "./Breadcrumbs";
import FilesystemQueryInput from "./FilesystemQueryInput";
import FilesystemPanelListContent from "./FilesystemPanelListContent";
import FilesystemStatusMessages from "./FilesystemStatusMessages";
import { normalizeFilesystemPaneState } from "./filesystemPaneState";
import { areSearchOptionsEqual, isSkippingFolders } from "./filesystemSearchOptions";
import useFilesystemNavigation from "./hooks/useFilesystemNavigation";
import useFilesystemPanelInteractions from "./hooks/useFilesystemPanelInteractions";
import useFilesystemStatePersistence from "./hooks/useFilesystemStatePersistence";
import useFilesystemThumbnails from "./hooks/useFilesystemThumbnails";
import useFilesystemTree from "./hooks/useFilesystemTree";
import useFilesystemViewStyle from "./hooks/useFilesystemViewStyle";
import useFilesystemWorkspaceFolders from "./hooks/useFilesystemWorkspaceFolders";
import useVirtualizedEntryWindow from "./hooks/useVirtualizedEntryWindow";
import useFilesystemPanelLoadMore from "./hooks/useFilesystemPanelLoadMore";
import useFilesystemShellMenu from "./hooks/useFilesystemShellMenu";
import useFilesystemClipboardCommands from "./hooks/useFilesystemClipboardCommands";
import useWorkspaceExitNavigation from "./hooks/useWorkspaceExitNavigation";
import useGridLayout from "./hooks/useGridLayout";
import useFoldableGridLayout from "./hooks/useFoldableGridLayout";
import { useNotificationCenter } from "../../notifications/notificationCenter";
import isEditableKeyboardTarget from "../../utils/isEditableKeyboardTarget";
import { uniqueNonEmptyPaths } from "../../utils/pathSelection";
import { COMMAND_IDS, isCommandShortcutMatch } from "../../commands/commandRegistry";
import { APP_COMMAND_EVENT } from "../../commands/commandEvents";
import executeCommand from "../../commands/executeCommand";
import { FILESYSTEM_FLUSH_STATE_EVENT } from "./filesystemPanelEvents";
import styles from "./FilesystemPanel.module.scss";
import shellStyles from "../PanelShell.module.scss";

const ENTRY_WINDOWING_THRESHOLD = 200;
const GRID_GAP_PX = 8;
const GRID_PADDING_PX = 8;
const GRID_LABEL_HEIGHT_PX = 32;
const GRID_CELL_CHROME_PX = 10; // a grid cell's padding and border, both sides
const GRID_MIN_CELL_WIDTH_PX = 72; // room for the name under a small icon
const THUMBNAIL_SIZE_TOGGLE_TITLE = "Toggle icon/thumbnail size";
const HISTORY_BACK_BUTTON_TITLE = "Go back in folder history";
const HISTORY_FORWARD_BUTTON_TITLE = "Go forward in folder history";

// After clicking a header button the keyboard belongs to the list of the pane under the pointer,
// which is this one: the button doesn't take focus, and whatever had it (the path editor, another
// pane's list) lets go. Keys on a header control focused with Tab stay with that control.
const releaseFocusOnMouseDown = (event) => {
  event.preventDefault();
  document.activeElement.blur();
};

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
  showHiddenFiles = true,
}) {
  const panelRef = useRef(null);
  const panelScrollRef = useRef(null);
  const entryWindowAnchorRef = useRef(null);
  const gridAnchorRef = useRef(null);
  const foldableGridAnchorRef = useRef(null);
  // State, not a ref: the grid is measured once it mounts, and it only exists in the grid views
  // (one of them at a time).
  const [gridElement, setGridElement] = useState(null);
  const onCurrentPathChangeRef = useRef(onCurrentPathChange);
  const initialFilesystemStateRef = useRef(normalizeFilesystemPaneState(filesystemState));
  const [expandedPaths, setExpandedPaths] = useState(initialFilesystemStateRef.current.expandedPaths);
  const [breadcrumbFocusRequestKey, setBreadcrumbFocusRequestKey] = useState(0);
  const [queryMode, setQueryMode] = useState("");
  const [queryFocusRequestKey, setQueryFocusRequestKey] = useState(0);
  const [searchOptions, setSearchOptions] = useState(initialFilesystemStateRef.current.searchOptions);
  // Keeps the same object when nothing changed, so committing an unedited list does not rerun the search.
  const updateSearchOptions = (patch) => setSearchOptions((current) => {
    const next = { ...current, ...patch };
    return areSearchOptionsEqual(current, next) ? current : next;
  });
  const {
    viewStyle,
    updateViewStyle,
    loadViewStyleForPath,
    stepThumbnailSize,
    handleCtrlWheel,
    sortBy,
    toggleSortDirection,
  } = useFilesystemViewStyle({
    initialFilesystemState: initialFilesystemStateRef.current,
    tabId,
    paneId,
    tabWorkspaceRoot,
  });
  const { viewType, thumbnailSizePx, sortKey, sortDescending } = viewStyle;
  const entryRowHeightPx = thumbnailSizePx;
  const { openConfirm, openChoice, pushNotification } = useNotificationCenter();
  const nav = useFilesystemNavigation(initialFilesystemStateRef.current, {
    tabId,
    tabWorkspaceRoot,
    pushNotification,
    openChoice,
    sortKey,
    sortDescending,
    searchOptions,
    showHidden: showHiddenFiles,
  });
  const {
    currentDrive,
    currentPath,
    selectedPaths,
    selectionFocusPath,
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
    filter,
    setFilter,
    searchQuery,
    setSearchQuery,
    isSearchActive,
    searchStatus,
    searchError,
    isMovingEntry,
    isDeletingEntries,
    isImportingExternal,
    transferProgress,
    cancelTransfer,
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
    sortKey,
    sortDescending,
    searchOptions,
  });
  const isBrowsing = currentPath !== "";
  const isEntryOperationInProgress = isMovingEntry || isDeletingEntries || isImportingExternal;
  const isExternalDragEnabled = isBrowsing && !isEntryOperationInProgress;
  const {
    treeRows,
    toggleDirectoryExpanded,
    expandDirectory,
    remapRenamedPath,
  } = useFilesystemTree({
    currentPath,
    rootEntries: entries,
    initialExpandedPaths: initialFilesystemStateRef.current.expandedPaths,
    onExpandedPathsChange: setExpandedPaths,
    sortKey,
    sortDescending,
    showHidden: showHiddenFiles,
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
  const isFoldableGridView = viewType === "foldable-grid" && isBrowsing;
  const isTileView = isGridView || isFoldableGridView;
  const gridMinCellWidthPx = Math.max(GRID_MIN_CELL_WIDTH_PX, thumbnailSizePx + GRID_CELL_CHROME_PX);
  const {
    columnCount: gridColumns,
    cellWidthPx: gridCellWidthPx,
    availableWidthPx: gridAvailableWidthPx,
  } = useGridLayout(gridElement, gridMinCellWidthPx, GRID_GAP_PX, GRID_PADDING_PX, isFoldableGridView);
  // Thumbnails fill their cell, so the chosen size is the smallest they get, except in the
  // foldable grid's opened folders, where they may be about 10% smaller (useFoldableGridLayout).
  // Small icons keep their size: those cells are only wider to fit the name. A line of tiles (a
  // grid row) is the preview, the name under it and the gap.
  const isGridFillingCells = thumbnailSizePx + GRID_CELL_CHROME_PX >= GRID_MIN_CELL_WIDTH_PX;
  const getGridTileSize = useCallback((cellWidthPx) => {
    const previewSizePx = isGridFillingCells ? cellWidthPx - GRID_CELL_CHROME_PX : thumbnailSizePx;
    return { previewSizePx, lineHeightPx: previewSizePx + GRID_LABEL_HEIGHT_PX + GRID_GAP_PX };
  }, [isGridFillingCells, thumbnailSizePx]);
  const { previewSizePx: gridPreviewPx, lineHeightPx: gridRowHeightPx } = getGridTileSize(gridCellWidthPx);
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
  // The tree's count, in entries rather than lines: that keeps the tiles rendered without a window
  // to about as many as the rows the tree would render.
  const isFoldableGridWindowingEnabled = isFoldableGridView && isEntryWindowingEnabled;
  const foldableGrid = useFoldableGridLayout({
    isEnabled: isFoldableGridView,
    isWindowingEnabled: isFoldableGridWindowingEnabled,
    treeRows,
    unresolvedRootEntryCount,
    thumbnailSizePx,
    availableWidthPx: gridAvailableWidthPx,
    minCellWidthPx: gridMinCellWidthPx,
    gapPx: GRID_GAP_PX,
    getTileSize: getGridTileSize,
    scrollContainerRef: panelScrollRef,
    anchorRef: foldableGridAnchorRef,
  });

  // What the view on screen renders gets thumbnails and workspace-folder styling.
  let effectiveVisibleEntries = visibleEntries;
  if (isGridView) effectiveVisibleEntries = visibleGridEntries;
  else if (isFoldableGridView) effectiveVisibleEntries = foldableGrid.visibleEntries;
  const { thumbnailSrcByPath } = useFilesystemThumbnails({
    currentPath,
    visibleEntries: effectiveVisibleEntries,
    // Filling previews grow with the pane up to about twice the chosen size (one column just short
    // of fitting two). Asking for that from the chosen size, not the measured one, means resizing
    // never swaps the cached size (and blanks the thumbnails) back and forth.
    thumbnailSizePx: isTileView && isGridFillingCells ? thumbnailSizePx * 2 : thumbnailSizePx,
  });
  const breadcrumbs = buildBreadcrumbs(currentPath, currentDrive);
  const workspaceFolderPathSet = useFilesystemWorkspaceFolders({
    entries: effectiveVisibleEntries,
    paths: breadcrumbs
      .map((crumb) => crumb.path)
      .filter((path) => typeof path === "string" && path),
  });
  // Grid view shows only the top level, while folders opened in the other views stay open (one set
  // per pane). What they hold must not join ranges, arrow keys, drags or Delete here.
  const viewRows = useMemo(
    () => (isGridView ? treeRows.filter((row) => row.depth === 0) : treeRows),
    [isGridView, treeRows],
  );
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
    handleFolderPathMiddleClick,
    handleEntryContextMenu,
    handlePanelBackgroundClick,
    handlePanelBackgroundContextMenu,
    beginRenameEntry,
    handleBeginRenameSelectedEntry,
    handleCreateTextFile,
    handleCreateFolder,
    handleEntryRenameCancel,
    handleEntryRenameSubmit,
    handleDeleteSelectedEntries,
    handlePanelKeyDown,
    openEntryPaths,
    handleOpenSelectedEntryInNewTab,
    isExternalDragOver,
  } = useFilesystemPanelInteractions({
    tabId,
    paneId,
    panelRef,
    currentPath,
    selectedPaths,
    selectionFocusPath,
    // Only the foldable grid moves by column; the other views keep to the entry order.
    getVerticalNeighbourPath: isFoldableGridView ? foldableGrid.getVerticalNeighbourPath : undefined,
    drivePaths: drives.map((drive) => drive.path),
    treeRows: viewRows,
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
    onExpandDirectory: expandDirectory,
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
  // App sends the pane's saved selection, which keeps items in opened folders while they aren't
  // shown (hidden files off, filtered out, folder closed, grid view). Commands act on shown rows.
  const resolveCommandSelectedEntryPaths = useCallback((commandContext = {}) => {
    const shownContextPaths = uniqueNonEmptyPaths(commandContext?.selectedPaths)
      .filter((path) => treeData.entryPathSet.has(path));
    return shownContextPaths.length > 0 ? shownContextPaths : selectedEntryPaths;
  }, [selectedEntryPaths, treeData.entryPathSet]);
  const showShellMenu = useFilesystemShellMenu({
    currentPath,
    resolveSelectedPaths: resolveCommandSelectedEntryPaths,
    onOpen: openEntryPaths,
    onRename: beginRenameEntry,
    pushNotification,
  });
  const { copySelection, pasteEntries } = useFilesystemClipboardCommands({
    isEnabled: isBrowsing && !isEntryOperationInProgress,
    currentPath,
    entryByPath: treeData.entryByPath,
    resolveSelectedPaths: resolveCommandSelectedEntryPaths,
    copyEntries,
    moveEntries,
  });
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
  const { navigateWithExitConfirm, openFolderPath } = useWorkspaceExitNavigation({
    tabId,
    isPrimaryFilesystemPane,
    tabWorkspaceRoot,
    openConfirm,
    navigateToPath,
    onOpenFolderInCurrentTab,
  });
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
        .filter((entry) => showHiddenFiles || !entry.is_hidden)
        .map((entry) => entry.path.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }, [showHiddenFiles]);
  const requestBreadcrumbInputFocus = useCallback(() => {
    setBreadcrumbFocusRequestKey((current) => current + 1);
  }, []);
  // Switching between filter and search carries the typed text over.
  const openQueryInput = useCallback((mode) => {
    if (mode === "search" && filter) {
      setSearchQuery(filter);
      setFilter("");
    }
    if (mode === "filter" && searchQuery) {
      setFilter(searchQuery);
      setSearchQuery("");
    }
    setQueryMode(mode);
    setQueryFocusRequestKey((current) => current + 1);
  }, [filter, searchQuery, setFilter, setSearchQuery]);

  useEffect(() => {
    onCurrentPathChangeRef.current = onCurrentPathChange;
  }, [onCurrentPathChange]);

  useEffect(() => {
    onCurrentPathChangeRef.current?.(currentPath);
  }, [currentPath]);

  useEffect(() => {
    loadViewStyleForPath(currentPath);
  }, [currentPath, loadViewStyleForPath]);

  useEffect(() => {
    setQueryMode("");
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

  // F2 renames the selection; Ctrl+Z undoes and Ctrl+Y (or Ctrl+Shift+Z) redoes this pane's last
  // file operation.
  const handleShortcutKeys = useCallback((event) => {
    if (event.defaultPrevented || isEditableKeyboardTarget(event.target)) return;
    if (isEntryOperationInProgress) return;

    if (isCommandShortcutMatch(COMMAND_IDS.FILESYSTEM_RENAME_SELECTED, event)) {
      if (event.repeat) return;
      event.preventDefault();
      executeFilesystemShortcutCommand(COMMAND_IDS.FILESYSTEM_RENAME_SELECTED);
      return;
    }

    if (event.metaKey || event.altKey || !event.ctrlKey) return;
    const pressedKey = event.key.toLowerCase();
    const wantsUndo = pressedKey === "z" && !event.shiftKey;
    const wantsRedo = pressedKey === "y" || (pressedKey === "z" && event.shiftKey);
    if (!wantsUndo && !wantsRedo) return;

    event.preventDefault();
    if (wantsUndo) undoEntries();
    else redoEntries();
  }, [executeFilesystemShortcutCommand, isEntryOperationInProgress, redoEntries, undoEntries]);
  useEffect(() => {
    // Keys go to the pane under the pointer. F2, Ctrl+Z and Ctrl+Y do so even while another pane's
    // list has focus, like the app's shortcuts, which send them there too: whichever of the two
    // the window runs first takes the key, and the other leaves it. Arrows, Enter and Delete go to
    // a focused list first (the section's onKeyDown), so one from inside a filesystem panel was
    // already offered to that panel; taking one it left alone would act on this pane.
    const handleWindowKeyDown = (event) => {
      if (!isPanelActive()) return;
      handleShortcutKeys(event);
      if (!event.target.closest?.("[data-filesystem-panel]")) handlePanelKeyDown(event);
    };

    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [handlePanelKeyDown, handleShortcutKeys, isPanelActive]);
  useEffect(() => {
    const handleAppCommand = (event) => {
      const detail = event?.detail ?? {};
      const { commandId = "", context = {} } = detail;
      if (!commandId) return;

      const targetPaneId = context?.targetPaneId || context?.activePaneId || "";
      if (targetPaneId && targetPaneId !== paneId) return;

      const commandHandlers = {
        [COMMAND_IDS.FILESYSTEM_RENAME_SELECTED]: () => handleBeginRenameSelectedEntry(),
        [COMMAND_IDS.FILESYSTEM_COPY]: () => copySelection("copy", context),
        [COMMAND_IDS.FILESYSTEM_CUT]: () => copySelection("cut", context),
        [COMMAND_IDS.FILESYSTEM_PASTE]: () => pasteEntries(context),
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
        [COMMAND_IDS.FILESYSTEM_GO_UP]: () => navigateWithExitConfirm(upDestinationPath),
        [COMMAND_IDS.FILESYSTEM_NAVIGATE_BACK]: () => goBack(),
        [COMMAND_IDS.FILESYSTEM_NAVIGATE_FORWARD]: () => goForward(),
        [COMMAND_IDS.FILESYSTEM_FOCUS_BREADCRUMB_INPUT]: () => requestBreadcrumbInputFocus(),
        [COMMAND_IDS.FILESYSTEM_FILTER_CURRENT_FOLDER]: () => openQueryInput("filter"),
        [COMMAND_IDS.FILESYSTEM_SEARCH_CURRENT_SUBTREE]: () => openQueryInput("search"),
        [COMMAND_IDS.FILESYSTEM_VIEW_FOLDER_TREE]: () => updateViewStyle({ viewType: "folder-tree" }),
        [COMMAND_IDS.FILESYSTEM_VIEW_DETAILS]: () => updateViewStyle({ viewType: "details" }),
        [COMMAND_IDS.FILESYSTEM_VIEW_GRID]: () => updateViewStyle({ viewType: "grid" }),
        [COMMAND_IDS.FILESYSTEM_VIEW_FOLDABLE_GRID]: () => updateViewStyle({ viewType: "foldable-grid" }),
        [COMMAND_IDS.FILESYSTEM_SORT_BY_NAME]: () => sortBy("name"),
        [COMMAND_IDS.FILESYSTEM_SORT_BY_MODIFIED]: () => sortBy("modified"),
        [COMMAND_IDS.FILESYSTEM_SORT_BY_SIZE]: () => sortBy("size"),
        [COMMAND_IDS.FILESYSTEM_SORT_BY_TYPE]: () => sortBy("type"),
        [COMMAND_IDS.FILESYSTEM_SORT_REVERSE]: () => toggleSortDirection(),
        [COMMAND_IDS.FILESYSTEM_SHOW_SHELL_MENU]: () => showShellMenu(context),
      };

      const commandHandler = commandHandlers[commandId];
      if (commandHandler) commandHandler();
    };

    window.addEventListener(APP_COMMAND_EVENT, handleAppCommand);
    return () => {
      window.removeEventListener(APP_COMMAND_EVENT, handleAppCommand);
    };
  }, [
    copySelection,
    handleBeginRenameSelectedEntry,
    handleCreateFolder,
    handleCreateTextFile,
    handleDeleteSelectedEntries,
    handleOpenSelectedEntryInNewTab,
    goBack,
    goForward,
    navigateWithExitConfirm,
    openQueryInput,
    paneId,
    pasteEntries,
    requestBreadcrumbInputFocus,
    resolveCreateCommandOptions,
    redoEntries,
    showShellMenu,
    sortBy,
    toggleSortDirection,
    undoEntries,
    upDestinationPath,
    updateViewStyle,
  ]);
  // Scrolling moves the window of the view on screen, and loads more once that window nears the
  // end of what is loaded, counted in its own units.
  let activeWindow = {
    scheduleRecompute: scheduleEntryWindowRecompute,
    isEnabled: isEntryWindowingEnabled,
    loadedCount: treeRows.length,
    endIndex: virtualEndIndex,
  };
  if (isGridView) {
    activeWindow = {
      scheduleRecompute: scheduleGridWindowRecompute,
      isEnabled: isGridWindowingEnabled,
      loadedCount: entries.length,
      endIndex: gridVirtualEndIndex * gridColumns,
    };
  } else if (isFoldableGridView) {
    activeWindow = {
      scheduleRecompute: foldableGrid.scheduleRecompute,
      isEnabled: isFoldableGridWindowingEnabled,
      loadedCount: foldableGrid.loadedLineCount,
      endIndex: foldableGrid.endIndex,
    };
  }
  const { handlePanelScroll } = useFilesystemPanelLoadMore({
    panelRef: panelScrollRef,
    handlePanelListScroll,
    scheduleEntryWindowRecompute: activeWindow.scheduleRecompute,
    isEntryWindowingEnabled: activeWindow.isEnabled,
    hasMoreEntries,
    isLoadingEntries,
    isLoadingMoreEntries,
    loadMoreEntries,
    isBrowsing,
    treeRowsCount: activeWindow.loadedCount,
    virtualEndIndex: activeWindow.endIndex,
  });
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
    data-filesystem-panel
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
        transferProgress={transferProgress}
        onCancelTransfer={cancelTransfer}
        error={error}
      />
      {queryMode && isBrowsing && <FilesystemQueryInput
        mode={queryMode}
        value={queryMode === "search" ? searchQuery : filter}
        focusRequestKey={queryFocusRequestKey}
        searchOptions={searchOptions}
        onSearchOptionsChange={updateSearchOptions}
        onChange={queryMode === "search" ? setSearchQuery : setFilter}
        onModeChange={openQueryInput}
        onClose={() => setQueryMode("")}
        onSubmit={() => {
          if (treeRows.length > 0) setSelectedPath(treeRows[0].entry.path);
        }}
      />}
      <div>
        <button
          type="button"
          className={styles.historyNavigationButton}
          onClick={goBack}
          onMouseDown={releaseFocusOnMouseDown}
          title={HISTORY_BACK_BUTTON_TITLE}
          aria-label={HISTORY_BACK_BUTTON_TITLE}
          disabled={!canGoBack}
        >←</button>
        <button
          type="button"
          className={styles.historyNavigationButton}
          onClick={goForward}
          onMouseDown={releaseFocusOnMouseDown}
          title={HISTORY_FORWARD_BUTTON_TITLE}
          aria-label={HISTORY_FORWARD_BUTTON_TITLE}
          disabled={!canGoForward}
        >→</button>
        <button
          type="button"
          className={styles.thumbnailSizeToggle}
          onClick={() => stepThumbnailSize(1, { wrap: true })}
          onMouseDown={releaseFocusOnMouseDown}
          title={THUMBNAIL_SIZE_TOGGLE_TITLE}
          aria-label={`Toggle icon and thumbnail size. Current: ${thumbnailSizePx}px`}
        >{thumbnailSizePx}px</button>
      </div>
    </PanelHeader>
    <div
      ref={panelScrollRef}
      className={`${shellStyles.panelBody} ${styles.panelScrollBody} ${isTileView ? styles.gridPanelBody : ""}`}
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
          unmatchedFilter: filter && !isSearchActive && hasLoadedCurrentPath && entries.length === 0 ? filter : "",
          search: isSearchActive
            ? {
              query: searchQuery.trim(),
              status: searchStatus,
              error: searchError,
              resultCount: entries.length,
              skipsFolders: isSkippingFolders(searchOptions),
            }
            : null,
        }}
        drives={{
          items: drives,
          selectedPathSet,
          onSelect: setSelectedPath,
          onOpen: selectDrive,
          onMiddleClick: handleFolderPathMiddleClick,
        }}
        breadcrumbs={{
          currentPath,
          currentDrive,
          onSelect: navigateWithExitConfirm,
          onMiddleClick: handleFolderPathMiddleClick,
          onPathSubmit: openFolderPath,
          loadSubfoldersForPath,
          focusPathInputRequestKey: breadcrumbFocusRequestKey,
          activeDragPaths: effectiveActiveDragPaths,
          isMovingEntry,
          getDropIdForPath: dnd.getBreadcrumbDropId,
          workspaceFolderPathSet,
          recentFoldersEntries,
          isLoadingRecentFolders: recentFoldersLoading,
          onSelectRecentFolder: openFolderPath,
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
        details={{
          sortKey,
          sortDescending,
          onSort: sortBy,
        }}
        grid={{
          entries: visibleGridEntries,
          selectedPathSet,
          thumbnailSrcByPath,
          workspaceFolderPathSet,
          containerRef: setGridElement,
          columnCount: gridColumns,
          minCellWidthPx: gridMinCellWidthPx,
          previewSizePx: gridPreviewPx,
          anchorRef: gridAnchorRef,
          topSpacerHeight: gridTopSpacerHeight,
          bottomSpacerHeight: gridBottomSpacerHeight,
          isWindowingEnabled: isGridWindowingEnabled,
          renamingPath,
          onEntryClick: handleEntryClick,
          onEntryDoubleClick: handleEntryDoubleClick,
          onEntryMiddleClick: handleEntryMiddleClick,
          onEntryContextMenu: handleEntryContextMenu,
          onEntryRenameSubmit: handleEntryRenameSubmit,
          onEntryRenameCancel: handleEntryRenameCancel,
        }}
        foldable={{
          lines: foldableGrid.lines,
          containerRef: setGridElement,
          anchorRef: foldableGridAnchorRef,
          isWindowingEnabled: isFoldableGridWindowingEnabled,
          topSpacerHeight: foldableGrid.topSpacerHeight,
          bottomSpacerHeight: foldableGrid.bottomSpacerHeight,
          tileLayouts: foldableGrid.tileLayouts,
          minCellWidthPx: gridMinCellWidthPx,
          folderLineHeightPx: foldableGrid.folderLineHeightPx,
          selectedPathSet,
          workspaceFolderPathSet,
        }}
      />
    </div>
  </section>;
}

export default FilesystemPanel;
