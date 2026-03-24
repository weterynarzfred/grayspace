import { useCallback, useEffect, useRef } from "react";
import {
  arePathArraysEqual,
  normalizeFilesystemPaneState,
} from "../filesystemPaneState";

const SCROLL_PERSIST_DEBOUNCE_MS = 120;

export default function useFilesystemStatePersistence({
  tabId = "",
  paneId = "",
  pane = "",
  onFilesystemStateChange = undefined,
  panelListRef = undefined,
  initialFilesystemState = undefined,
  currentDrive = "",
  currentPath = "",
  selectedPath = "",
  selectedPaths = [],
}) {
  const initialFilesystemStateRef = useRef(
    normalizeFilesystemPaneState(initialFilesystemState),
  );
  const resolvedPaneId = paneId || pane;
  const lastPersistedStateRef = useRef(initialFilesystemStateRef.current);
  const latestScrollTopRef = useRef(initialFilesystemStateRef.current.scrollTop);
  const scrollPersistTimeoutRef = useRef(null);

  const persistFilesystemState = useCallback((nextState) => {
    if (typeof onFilesystemStateChange !== "function" || !tabId || !resolvedPaneId) return;

    const normalizedState = normalizeFilesystemPaneState(nextState);
    const lastState = lastPersistedStateRef.current;
    const hasChanged = normalizedState.currentDrive !== lastState.currentDrive
      || normalizedState.currentPath !== lastState.currentPath
      || normalizedState.selectedPath !== lastState.selectedPath
      || !arePathArraysEqual(normalizedState.selectedPaths, lastState.selectedPaths)
      || normalizedState.scrollTop !== lastState.scrollTop;

    if (!hasChanged) return;

    lastPersistedStateRef.current = normalizedState;
    onFilesystemStateChange(normalizedState);
  }, [onFilesystemStateChange, resolvedPaneId, tabId]);

  const persistCurrentFilesystemState = useCallback(() => {
    persistFilesystemState({
      currentDrive,
      currentPath,
      selectedPath,
      selectedPaths,
      scrollTop: latestScrollTopRef.current,
    });
  }, [
    currentDrive,
    currentPath,
    persistFilesystemState,
    selectedPath,
    selectedPaths,
  ]);

  useEffect(() => {
    if (!panelListRef?.current) return;

    panelListRef.current.scrollTop = initialFilesystemStateRef.current.scrollTop;
    latestScrollTopRef.current = panelListRef.current.scrollTop;
  }, [panelListRef]);

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

  return {
    handlePanelListScroll,
  };
}
