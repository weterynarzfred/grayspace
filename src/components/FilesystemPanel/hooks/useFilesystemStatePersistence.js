import { useCallback, useEffect, useRef } from "react";
import {
  arePathArraysEqual,
  normalizeFilesystemPaneState,
} from "../filesystemPaneState";

const SCROLL_PERSIST_DEBOUNCE_MS = 120;

export default function useFilesystemStatePersistence({
  tabId = "",
  paneId = "",
  onFilesystemStateChange = undefined,
  panelListRef = undefined,
  initialFilesystemState = undefined,
  currentDrive = "",
  currentPath = "",
  selectedPaths = [],
  expandedPaths = [],
}) {
  const initialFilesystemStateRef = useRef(
    normalizeFilesystemPaneState(initialFilesystemState),
  );
  const lastPersistedStateRef = useRef(initialFilesystemStateRef.current);
  const latestScrollTopRef = useRef(initialFilesystemStateRef.current.scrollTop);
  const scrollPersistTimeoutRef = useRef(null);

  const persistFilesystemState = useCallback((nextState) => {
    if (typeof onFilesystemStateChange !== "function" || !tabId || !paneId) return;

    const normalizedState = normalizeFilesystemPaneState(nextState);
    const lastState = lastPersistedStateRef.current;
    const hasChanged = normalizedState.currentDrive !== lastState.currentDrive
      || normalizedState.currentPath !== lastState.currentPath
      || !arePathArraysEqual(normalizedState.selectedPaths, lastState.selectedPaths)
      || !arePathArraysEqual(normalizedState.expandedPaths, lastState.expandedPaths)
      || normalizedState.scrollTop !== lastState.scrollTop;

    if (!hasChanged) return;

    lastPersistedStateRef.current = normalizedState;
    onFilesystemStateChange(normalizedState);
  }, [onFilesystemStateChange, paneId, tabId]);

  const persistCurrentFilesystemState = useCallback(() => {
    persistFilesystemState({
      currentDrive,
      currentPath,
      selectedPaths,
      expandedPaths,
      scrollTop: latestScrollTopRef.current,
    });
  }, [
    currentDrive,
    currentPath,
    expandedPaths,
    persistFilesystemState,
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
