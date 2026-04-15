import { useCallback, useEffect, useRef } from "react";
import {
  arePathArraysEqual,
  normalizeFilesystemPaneState,
} from "../filesystemPaneState";

export default function useFilesystemStatePersistence({
  tabId = "",
  paneId = "",
  onFilesystemStateChange,
  panelListRef,
  initialFilesystemState,
  isLoadingEntries = false,
  isLoadingMoreEntries = false,
  hasMoreEntries = false,
  hasLoadedCurrentPath = false,
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
  const pendingInitialScrollRestoreRef = useRef(true);
  const initialScrollTopRef = useRef(Math.max(0, Math.round(initialFilesystemStateRef.current.scrollTop)));
  const scrollPersistRafRef = useRef(null);

  useEffect(() => {
    const normalizedInitialState = normalizeFilesystemPaneState(initialFilesystemState);
    initialFilesystemStateRef.current = normalizedInitialState;
    lastPersistedStateRef.current = normalizedInitialState;
    latestScrollTopRef.current = normalizedInitialState.scrollTop;
    initialScrollTopRef.current = Math.max(0, Math.round(normalizedInitialState.scrollTop));
    pendingInitialScrollRestoreRef.current = true;

    if (scrollPersistRafRef.current !== null) {
      cancelAnimationFrame(scrollPersistRafRef.current);
      scrollPersistRafRef.current = null;
    }
  }, [paneId, tabId]);

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
    const panelList = panelListRef?.current;
    if (!panelList || !pendingInitialScrollRestoreRef.current) return;
    if (isLoadingEntries || isLoadingMoreEntries) return;

    const targetScrollTop = initialScrollTopRef.current;
    if (targetScrollTop > 0 && !hasLoadedCurrentPath) return;

    if (targetScrollTop <= 0) {
      latestScrollTopRef.current = panelList.scrollTop;
      pendingInitialScrollRestoreRef.current = false;
      return;
    }

    panelList.scrollTop = targetScrollTop;

    const reachedTargetScroll = panelList.scrollTop >= targetScrollTop;
    const cannotRestoreFurther = !hasMoreEntries && panelList.scrollTop < targetScrollTop;
    if (reachedTargetScroll || cannotRestoreFurther) {
      latestScrollTopRef.current = panelList.scrollTop;
      pendingInitialScrollRestoreRef.current = false;
    }
  }, [
    currentPath,
    hasLoadedCurrentPath,
    hasMoreEntries,
    isLoadingEntries,
    isLoadingMoreEntries,
    panelListRef,
  ]);

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
      if (scrollPersistRafRef.current !== null) {
        cancelAnimationFrame(scrollPersistRafRef.current);
        scrollPersistRafRef.current = null;
      }
      persistCurrentFilesystemState();
    };
  }, [persistCurrentFilesystemState]);

  const handlePanelListScroll = useCallback((event) => {
    if (pendingInitialScrollRestoreRef.current) {
      pendingInitialScrollRestoreRef.current = false;
    }

    const nextScrollTop = Math.max(0, Math.round(event.currentTarget.scrollTop));
    latestScrollTopRef.current = nextScrollTop;

    if (scrollPersistRafRef.current !== null) return;

    scrollPersistRafRef.current = requestAnimationFrame(() => {
      scrollPersistRafRef.current = null;
      persistCurrentFilesystemState();
    });
  }, [persistCurrentFilesystemState]);

  const flushFilesystemState = useCallback(() => {
    if (scrollPersistRafRef.current !== null) {
      cancelAnimationFrame(scrollPersistRafRef.current);
      scrollPersistRafRef.current = null;
    }
    persistCurrentFilesystemState();
  }, [persistCurrentFilesystemState]);

  return {
    handlePanelListScroll,
    flushFilesystemState,
  };
}
