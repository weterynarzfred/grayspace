import { useCallback, useEffect, useRef, useState } from "react";
import { getErrorMessage } from "../../workspace/appRuntime";
import {
  workspaceRecentFoldersList,
  workspaceRecentFoldersRemove,
} from "../../workspace/workspaceApi";

// Command palette, context menu and recent folders. Palette and recent folders open at the
// last pointer position; a notification closes them all.
export default function useAppPopovers({ activeNotification, pushNotification }) {
  const [commandPaletteState, setCommandPaletteState] = useState({
    isOpen: false,
    position: { x: 24, y: 24 },
  });
  const [contextMenuState, setContextMenuState] = useState({
    isOpen: false,
    position: { x: 24, y: 24 },
    target: null,
    context: null,
  });
  const [recentFoldersState, setRecentFoldersState] = useState({
    isOpen: false,
    isLoading: false,
    position: { x: 24, y: 24 },
    entries: [],
  });
  const lastPointerPositionRef = useRef({ x: 24, y: 24 });
  const recentFoldersRequestIdRef = useRef(0);

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteState((state) => state.isOpen ? { ...state, isOpen: false } : state);
  }, []);
  const closeContextMenu = useCallback(() => {
    setContextMenuState((state) => state.isOpen
      ? { ...state, isOpen: false, target: null, context: null }
      : state);
  }, []);
  const closeRecentFolders = useCallback(() => {
    setRecentFoldersState((state) => state.isOpen
      ? { ...state, isOpen: false, isLoading: false }
      : state);
  }, []);
  const refreshRecentFolders = useCallback(async ({ notifyOnError = false } = {}) => {
    const nextRequestId = recentFoldersRequestIdRef.current + 1;
    recentFoldersRequestIdRef.current = nextRequestId;
    setRecentFoldersState((state) => ({ ...state, isLoading: true }));

    try {
      const entries = await workspaceRecentFoldersList();
      if (recentFoldersRequestIdRef.current !== nextRequestId) return [];
      const nextEntries = Array.isArray(entries) ? entries : [];
      setRecentFoldersState((state) => ({
        ...state,
        entries: nextEntries,
        isLoading: false,
      }));
      return nextEntries;
    } catch (error) {
      if (recentFoldersRequestIdRef.current !== nextRequestId) return [];
      setRecentFoldersState((state) => ({ ...state, entries: [], isLoading: false }));
      if (notifyOnError) {
        pushNotification?.({
          title: "Failed to load recent folders",
          message: getErrorMessage(error),
          tone: "error",
        });
      }
      return [];
    }
  }, [pushNotification]);
  const forgetRecentFolder = useCallback((path) => {
    workspaceRecentFoldersRemove(path).catch(() => { });
    setRecentFoldersState((state) => ({
      ...state,
      entries: state.entries.filter((entry) => entry.path !== path),
    }));
  }, []);
  const openCommandPalette = useCallback(() => {
    setCommandPaletteState({
      isOpen: true,
      position: { ...lastPointerPositionRef.current },
    });
    closeContextMenu();
    closeRecentFolders();
  }, [closeContextMenu, closeRecentFolders]);
  const openContextMenu = useCallback((position, target, context) => {
    setContextMenuState({ isOpen: true, position, target, context });
    closeCommandPalette();
  }, [closeCommandPalette]);
  const openRecentFolders = useCallback(() => {
    setRecentFoldersState((state) => ({
      ...state,
      isOpen: true,
      position: { ...lastPointerPositionRef.current },
    }));
    closeCommandPalette();
    closeContextMenu();
    refreshRecentFolders({ notifyOnError: true });
  }, [closeCommandPalette, closeContextMenu, refreshRecentFolders]);
  const handlePointerMoveCapture = useCallback((event) => {
    lastPointerPositionRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
  }, []);

  useEffect(() => {
    if (!activeNotification) return;
    closeContextMenu();
    closeCommandPalette();
    closeRecentFolders();
  }, [activeNotification, closeCommandPalette, closeContextMenu, closeRecentFolders]);

  return {
    commandPaletteState,
    contextMenuState,
    recentFoldersState,
    openCommandPalette,
    closeCommandPalette,
    openContextMenu,
    closeContextMenu,
    openRecentFolders,
    closeRecentFolders,
    refreshRecentFolders,
    forgetRecentFolder,
    handlePointerMoveCapture,
  };
}
