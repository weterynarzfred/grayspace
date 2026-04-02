import { useCallback, useEffect, useRef } from "react";
import {
  arePathArraysEqual,
  normalizeFilesystemPaneState,
} from "../filesystemPaneState";

const SCROLL_PERSIST_DEBOUNCE_MS = 450;

export default function useFilesystemStatePersistence({
  tabId = "",
  paneId = "",
  onFilesystemStateChange,
  panelListRef,
  initialFilesystemState,
  currentDrive = "",
  currentPath = "",
  selectedPaths = [],
  expandedPaths = [],
  thumbnailSizePx,
}) {
  const initialFilesystemStateRef = useRef(
    normalizeFilesystemPaneState(initialFilesystemState),
  );
  const onFilesystemStateChangeRef = useRef(onFilesystemStateChange);
  const lastPersistedStateRef = useRef(initialFilesystemStateRef.current);
  const latestStateRef = useRef({
    currentDrive,
    currentPath,
    selectedPaths,
    expandedPaths,
    thumbnailSizePx,
  });
  const latestScrollTopRef = useRef(initialFilesystemStateRef.current.scrollTop);
  const scrollPersistTimeoutRef = useRef(null);

  useEffect(() => {
    onFilesystemStateChangeRef.current = onFilesystemStateChange;
  }, [onFilesystemStateChange]);

  useEffect(() => {
    latestStateRef.current = {
      currentDrive,
      currentPath,
      selectedPaths,
      expandedPaths,
      thumbnailSizePx,
    };
  }, [
    currentDrive,
    currentPath,
    expandedPaths,
    selectedPaths,
    thumbnailSizePx,
  ]);

  const persistFilesystemState = useCallback((nextState) => {
    const onFilesystemStateChange = onFilesystemStateChangeRef.current;
    if (!onFilesystemStateChange || !tabId || !paneId) return;

    const normalizedState = normalizeFilesystemPaneState(nextState);
    const lastState = lastPersistedStateRef.current;
    const hasChanged = normalizedState.currentDrive !== lastState.currentDrive
      || normalizedState.currentPath !== lastState.currentPath
      || !arePathArraysEqual(normalizedState.selectedPaths, lastState.selectedPaths)
      || !arePathArraysEqual(normalizedState.expandedPaths, lastState.expandedPaths)
      || normalizedState.scrollTop !== lastState.scrollTop
      || normalizedState.thumbnailSizePx !== lastState.thumbnailSizePx;

    if (!hasChanged) return;

    lastPersistedStateRef.current = normalizedState;
    onFilesystemStateChange(normalizedState);
  }, [paneId, tabId]);

  const persistCurrentFilesystemState = useCallback(() => {
    const latestState = latestStateRef.current;
    persistFilesystemState({
      currentDrive: latestState.currentDrive,
      currentPath: latestState.currentPath,
      selectedPaths: latestState.selectedPaths,
      expandedPaths: latestState.expandedPaths,
      scrollTop: latestScrollTopRef.current,
      thumbnailSizePx: latestState.thumbnailSizePx,
    });
  }, [persistFilesystemState]);

  useEffect(() => {
    if (!panelListRef?.current) return;

    panelListRef.current.scrollTop = initialFilesystemStateRef.current.scrollTop;
    latestScrollTopRef.current = panelListRef.current.scrollTop;
  }, [panelListRef]);

  useEffect(() => {
    persistCurrentFilesystemState();
  }, [
    currentDrive,
    currentPath,
    expandedPaths,
    persistCurrentFilesystemState,
    selectedPaths,
    thumbnailSizePx,
  ]);

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

    if (scrollPersistTimeoutRef.current) {
      clearTimeout(scrollPersistTimeoutRef.current);
      scrollPersistTimeoutRef.current = null;
    }
    scrollPersistTimeoutRef.current = setTimeout(() => {
      scrollPersistTimeoutRef.current = null;
      persistCurrentFilesystemState();
    }, SCROLL_PERSIST_DEBOUNCE_MS);
  }, [persistCurrentFilesystemState]);

  return {
    handlePanelListScroll,
  };
}
