import { DragOverlay } from "@dnd-kit/core";
import { useCallback, useEffect, useRef } from "react";
import { usePanelsDndHandlers } from "../PanelsDndLayer";
import PanelHeader from "../PanelHeader";
import Breadcrumbs, { buildBreadcrumbs } from "./Breadcrumbs";
import DraggableFilesystemEntry from "./DraggableFilesystemEntry";
import EntryItem from "./EntryItem";
import FilesystemStatusMessages from "./FilesystemStatusMessages";
import UpEntryDropTarget from "./UpEntryDropTarget";
import useFilesystemDnd from "./hooks/useFilesystemDnd";
import useExternalFilesystemDrop from "./hooks/useExternalFilesystemDrop";
import useFilesystemNavigation from "./hooks/useFilesystemNavigation";
import styles from "./FilesystemPanel.module.scss";

const UP_ENTRY_SELECTION_ID = "__up__";
const SCROLL_PERSIST_DEBOUNCE_MS = 120;

function normalizeFilesystemState(filesystemState) {
  const state = filesystemState ?? {};
  return {
    currentDrive: typeof state.currentDrive === "string" ? state.currentDrive : "",
    currentPath: typeof state.currentPath === "string" ? state.currentPath : "",
    selectedPath: typeof state.selectedPath === "string" ? state.selectedPath : "",
    scrollTop: Number.isFinite(state.scrollTop) ? Math.max(0, Math.round(state.scrollTop)) : 0,
  };
}

function FilesystemPanel({
  tabId = "",
  pane = "",
  panelType = "Filesystem",
  onPanelTypeChange = undefined,
  onCurrentPathChange = undefined,
  onFilesystemStateChange = undefined,
  filesystemState = undefined,
}) {
  const panelRef = useRef(null);
  const panelListRef = useRef(null);
  const initialFilesystemStateRef = useRef(normalizeFilesystemState(filesystemState));
  const lastPersistedStateRef = useRef(initialFilesystemStateRef.current);
  const latestScrollTopRef = useRef(initialFilesystemStateRef.current.scrollTop);
  const scrollPersistTimeoutRef = useRef(null);
  const nav = useFilesystemNavigation(initialFilesystemStateRef.current);
  const isBrowsing = nav.currentPath !== "";
  const isEntryOperationInProgress = nav.isMovingEntry || nav.isImportingExternal;
  const dnd = useFilesystemDnd({
    entries: nav.entries,
    currentPath: nav.currentPath,
    isMovingEntry: isEntryOperationInProgress,
    moveEntry: nav.moveEntry,
  });
  const { isExternalDragOver } = useExternalFilesystemDrop({
    panelRef,
    isEnabled: isBrowsing && !isEntryOperationInProgress,
    onDropPaths: nav.importExternalPaths,
  });
  usePanelsDndHandlers({
    onDragStart: dnd.handleDragStart,
    onDragEnd: dnd.handleDragEnd,
    onDragCancel: dnd.handleDragCancel,
  });
  const activeDragEntry =
    nav.entries.find((entry) => entry.path === dnd.activeDragPath) ?? null;
  const breadcrumbs = buildBreadcrumbs(nav.currentPath, nav.currentDrive);
  const upDestinationPath =
    breadcrumbs.length > 2 ? breadcrumbs[breadcrumbs.length - 2].path : "";

  const persistFilesystemState = useCallback((nextState) => {
    if (typeof onFilesystemStateChange !== "function" || !tabId || !pane) return;

    const normalizedState = normalizeFilesystemState(nextState);
    const lastState = lastPersistedStateRef.current;
    const hasChanged = normalizedState.currentDrive !== lastState.currentDrive
      || normalizedState.currentPath !== lastState.currentPath
      || normalizedState.selectedPath !== lastState.selectedPath
      || normalizedState.scrollTop !== lastState.scrollTop;

    if (!hasChanged) return;

    lastPersistedStateRef.current = normalizedState;
    onFilesystemStateChange(normalizedState);
  }, [onFilesystemStateChange, pane, tabId]);

  const persistCurrentFilesystemState = useCallback(() => {
    persistFilesystemState({
      currentDrive: nav.currentDrive,
      currentPath: nav.currentPath,
      selectedPath: nav.selectedPath,
      scrollTop: latestScrollTopRef.current,
    });
  }, [
    nav.currentDrive,
    nav.currentPath,
    nav.selectedPath,
    persistFilesystemState,
  ]);

  useEffect(() => {
    if (typeof onCurrentPathChange === "function")
      onCurrentPathChange(nav.currentPath);
  }, [nav.currentPath, onCurrentPathChange]);

  useEffect(() => {
    if (!panelListRef.current) return;
    panelListRef.current.scrollTop = initialFilesystemStateRef.current.scrollTop;
    latestScrollTopRef.current = panelListRef.current.scrollTop;
  }, []);

  useEffect(() => {
    persistCurrentFilesystemState();
  }, [persistCurrentFilesystemState]);

  useEffect(() => {
    return () => {
      if (scrollPersistTimeoutRef.current) {
        clearTimeout(scrollPersistTimeoutRef.current);
        scrollPersistTimeoutRef.current = null;
      }
      persistCurrentFilesystemState();
    };
  }, [persistCurrentFilesystemState]);

  const handlePanelListScroll = useCallback((event) => {
    const nextScrollTop = Math.max(0, Math.round(event.currentTarget.scrollTop));
    latestScrollTopRef.current = nextScrollTop;

    if (scrollPersistTimeoutRef.current) return;
    scrollPersistTimeoutRef.current = setTimeout(() => {
      scrollPersistTimeoutRef.current = null;
      persistCurrentFilesystemState();
    }, SCROLL_PERSIST_DEBOUNCE_MS);
  }, [persistCurrentFilesystemState]);

  return (
    <section
      ref={panelRef}
      className={`${styles.panelContent} ${isExternalDragOver ? styles.externalDropTarget : ""}`}
      aria-label="Filesystem panel"
    >
      <PanelHeader
        panelType={panelType}
        onPanelTypeChange={onPanelTypeChange}
      >
        <h2 className={styles.title}>{isBrowsing ? "Files" : "Drives"}</h2>
      </PanelHeader>
      <div
        ref={panelListRef}
        className={styles.panelList}
        onScroll={handlePanelListScroll}
        data-testid="filesystem-panel-list"
      >
        <FilesystemStatusMessages
          isBrowsing={isBrowsing}
          isLoadingDrives={nav.isLoadingDrives}
          isLoadingEntries={nav.isLoadingEntries}
          isMovingEntry={nav.isMovingEntry}
          isImportingExternal={nav.isImportingExternal}
          error={nav.error}
        />

        {!isBrowsing && !nav.isLoadingDrives && !nav.error && (
          <ul className={styles.entryList}>
            {nav.drives.map((drive) => (
              <EntryItem
                key={drive.path}
                label={drive.name}
                meta={drive.path}
                isSelected={nav.selectedPath === drive.path}
                onClick={() => nav.setSelectedPath(drive.path)}
                onDoubleClick={() => nav.selectDrive(drive.path)}
              />
            ))}
          </ul>
        )}

        {isBrowsing && (
          <>
            <Breadcrumbs
              currentPath={nav.currentPath}
              currentDrive={nav.currentDrive}
              onSelect={nav.setCurrentPath}
              activeDragPath={dnd.activeDragPath}
              isMovingEntry={nav.isMovingEntry}
              getDropIdForPath={dnd.getBreadcrumbDropId}
            />

            {!nav.isLoadingEntries && !nav.error && (
              <ul className={styles.entryList}>
                <UpEntryDropTarget
                  destinationPath={upDestinationPath}
                  isSelected={nav.selectedPath === UP_ENTRY_SELECTION_ID}
                  isMovingEntry={isEntryOperationInProgress}
                  activeDragPath={dnd.activeDragPath}
                  onClick={() => nav.setSelectedPath(UP_ENTRY_SELECTION_ID)}
                  onDoubleClick={nav.goUp}
                />
                {nav.entries.map((entry) => (
                  <DraggableFilesystemEntry
                    key={entry.path}
                    entry={entry}
                    isSelected={nav.selectedPath === entry.path}
                    isMovingEntry={isEntryOperationInProgress}
                    activeDragPath={dnd.activeDragPath}
                    onClick={() => nav.selectEntry(entry.path)}
                    onDoubleClick={() => nav.openEntry(entry)}
                  />
                ))}
              </ul>
            )}
            <DragOverlay dropAnimation={null}>
              {activeDragEntry && (
                <div className={styles.dragOverlay}>
                  <span className={styles.dragOverlayName}>{activeDragEntry.name}</span>
                  <span className={styles.dragOverlayMeta}>
                    {activeDragEntry.is_dir ? "Folder" : "File"}
                  </span>
                </div>
              )}
            </DragOverlay>
          </>
        )}
      </div>
    </section>
  );
}

export default FilesystemPanel;
