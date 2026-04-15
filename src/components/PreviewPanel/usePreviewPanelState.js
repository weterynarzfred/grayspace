import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelsDndHandlers, usePanelsDragActive } from "../PanelsDndLayer";
import { getDraggedPathsFromDndEvent } from "../dndEventPaths";
import useExternalPathDrop from "../hooks/useExternalPathDrop";
import useFilesystemDirectoryWatcher from "../FilesystemPanel/hooks/useFilesystemDirectoryWatcher";
import { useNotificationCenter } from "../../notifications/notificationCenter";
import { uniqueNonEmptyPaths } from "../../utils/pathSelection";
import { getParentDirectoryPath, isSamePath } from "../../utils/pathWatch";
import {
  getErrorMessage,
  getPathDisplayName,
  getSaveStatusMessage,
  INITIAL_PREVIEW_STATE,
  isFolderPreviewErrorMessage,
} from "./previewPanelUtils";
import {
  getActivePreviewTab,
  normalizePreviewPaneState,
} from "./previewPaneState";

function isMediaPreviewKind(kind) {
  return kind === "image" || kind === "audio" || kind === "video";
}

function appendCacheBuster(src, token) {
  if (!src) return src;
  return `${src}${src.includes("?") ? "&" : "?"}v=${token}`;
}

function usePreviewPanelState({
  paneId = "",
  previewPaneState = undefined,
  onOpenPreviewPath = undefined,
  onActivatePreviewTab = undefined,
  onClosePreviewTab = undefined,
  onUpdatePreviewTab = undefined,
  onPaneDirtyStateChange = undefined,
}) {
  const normalizedPreviewPaneState = useMemo(
    () => normalizePreviewPaneState(previewPaneState),
    [previewPaneState],
  );
  const previewTabs = normalizedPreviewPaneState.tabs;
  const { openConfirm } = useNotificationCenter();
  const activePreviewTab = useMemo(
    () => getActivePreviewTab(normalizedPreviewPaneState),
    [normalizedPreviewPaneState],
  );
  const previewPath = activePreviewTab?.path ?? "";
  const activePreviewTabDraftContent = typeof activePreviewTab?.draftContent === "string"
    ? activePreviewTab.draftContent
    : "";
  const activePreviewTabDirty = Boolean(activePreviewTab?.isDirty);
  const [textContent, setTextContent] = useState("");
  const [saveStatus, setSaveStatus] = useState("idle");
  const [saveError, setSaveError] = useState("");
  const [previewReloadVersion, setPreviewReloadVersion] = useState(0);
  const [mediaSrcVersion, setMediaSrcVersion] = useState(0);
  const [previewState, setPreviewState] = useState(INITIAL_PREVIEW_STATE);
  const latestSaveRequestRef = useRef(0);
  const previewDropId = useMemo(() => `preview-drop:${paneId || "preview"}`, [paneId]);
  const previewLabel = useMemo(() => getPathDisplayName(previewPath), [previewPath]);
  const previewDirectoryPath = useMemo(() => getParentDirectoryPath(previewPath), [previewPath]);
  const mediaPreviewSrc = useMemo(() => {
    if (previewState.status !== "ready" || !previewPath) return null;
    return isMediaPreviewKind(previewState.preview?.kind)
      ? appendCacheBuster(convertFileSrc(previewPath), mediaSrcVersion)
      : null;
  }, [mediaSrcVersion, previewPath, previewState]);
  const isTextPreviewReady = previewState.status === "ready" && previewState.preview?.kind === "text";
  const isTextEditable = isTextPreviewReady && !previewState.preview?.truncated;

  const openDroppedPaths = useCallback((paths) => {
    const droppedPaths = uniqueNonEmptyPaths(paths);
    droppedPaths.forEach(path => {
      onOpenPreviewPath?.(path, { openMode: "pinned" });
    });
  }, [onOpenPreviewPath]);

  const saveTextFile = useCallback(async (path, content) => {
    const requestId = latestSaveRequestRef.current + 1;
    latestSaveRequestRef.current = requestId;
    setSaveStatus("saving");
    setSaveError("");

    try {
      await invoke("preview_write_text_file", { path, content });
      if (latestSaveRequestRef.current !== requestId) return;
      setSaveStatus("saved");
      onUpdatePreviewTab?.(path, {
        isDirty: false,
        draftContent: content,
      });
    } catch (saveLoadError) {
      if (latestSaveRequestRef.current !== requestId) return;
      setSaveStatus("error");
      setSaveError(getErrorMessage(saveLoadError));
    }
  }, [onUpdatePreviewTab]);

  const {
    isOver: isDropOver,
    setNodeRef: setDropNodeRef,
  } = useDroppable({
    id: previewDropId,
    data: {
      kind: "preview",
      paneId,
    },
  });
  const isPanelsDragActive = usePanelsDragActive();
  const panelRef = useRef(null);
  const setPanelNodeRef = useCallback((node) => {
    panelRef.current = node;
    setDropNodeRef(node);
  }, [setDropNodeRef]);

  usePanelsDndHandlers({
    onDragEnd: (event) => {
      if (event?.over?.id !== previewDropId) return;
      if (event?.active?.data?.current?.kind === "preview-tab") return;
      openDroppedPaths(getDraggedPathsFromDndEvent(event));
    },
  });

  const { isExternalDragOver } = useExternalPathDrop({
    panelRef,
    isEnabled: true,
    onDropPaths: openDroppedPaths,
  });

  const handlePreviewFileWatchChange = useCallback((_watchedPath, changedPath) => {
    if (!previewPath) return;
    if (activePreviewTabDirty || saveStatus === "saving") return;

    if (typeof changedPath === "string" && changedPath) {
      const isPreviewPathChange = isSamePath(changedPath, previewPath);
      const isDirectoryLevelChange = previewDirectoryPath
        && isSamePath(changedPath, previewDirectoryPath);
      if (!isPreviewPathChange && !isDirectoryLevelChange) return;
    }

    setPreviewReloadVersion(version => version + 1);
  }, [activePreviewTabDirty, previewDirectoryPath, previewPath, saveStatus]);

  useFilesystemDirectoryWatcher({
    watchPaths: previewDirectoryPath ? [previewDirectoryPath] : [],
    onDirectoryChange: handlePreviewFileWatchChange,
  });

  const handleTextContentChange = useCallback((nextContent) => {
    if (!isTextEditable || !previewPath) return;
    setTextContent(nextContent);
    setSaveStatus("dirty");
    setSaveError("");
    onUpdatePreviewTab?.(previewPath, {
      isDirty: true,
      isEphemeral: false,
      draftContent: nextContent,
    });
  }, [isTextEditable, onUpdatePreviewTab, previewPath]);

  const handleSaveNow = useCallback(() => {
    if (!isTextEditable || !previewPath) return;
    saveTextFile(previewPath, textContent);
  }, [isTextEditable, previewPath, saveTextFile, textContent]);

  useEffect(() => {
    if (!previewPath) {
      latestSaveRequestRef.current += 1;
      setPreviewState(INITIAL_PREVIEW_STATE);
      setTextContent("");
      setSaveStatus("idle");
      setSaveError("");
      return undefined;
    }

    let cancelled = false;
    latestSaveRequestRef.current += 1;
    setSaveStatus(activePreviewTabDirty ? "dirty" : "idle");
    setSaveError("");
    setMediaSrcVersion(version => version + 1);

    async function loadPreview() {
      setPreviewState({
        status: "loading",
        preview: null,
        error: "",
      });

      try {
        const preview = await invoke("preview_read_file", { path: previewPath });
        if (cancelled) return;
        if (preview?.kind === "text" && typeof preview.content === "string") {
          setTextContent(activePreviewTabDirty ? activePreviewTabDraftContent : preview.content);
        } else {
          setTextContent("");
        }
        setPreviewState({
          status: "ready",
          preview,
          error: "",
        });
      } catch (loadError) {
        if (cancelled) return;
        const errorMessage = getErrorMessage(loadError);
        if (isFolderPreviewErrorMessage(errorMessage)) {
          setPreviewState({
            status: "ready",
            preview: {
              kind: "unsupported",
              reason: "Folder previews are not supported yet.",
            },
            error: "",
          });
          return;
        }
        setPreviewState({
          status: "error",
          preview: null,
          error: errorMessage,
        });
      }
    }

    loadPreview();
    return () => { cancelled = true; };
  }, [
    previewPath,
    previewReloadVersion,
  ]);

  const saveStatusMessage = useMemo(() => getSaveStatusMessage({
    isTextPreviewReady,
    isTextEditable,
    saveStatus,
    saveError,
  }), [isTextEditable, isTextPreviewReady, saveError, saveStatus]);

  const handlePreviewTabActivate = useCallback((path) => {
    onActivatePreviewTab?.(path);
  }, [onActivatePreviewTab]);

  const handlePreviewTabClose = useCallback(async (path) => {
    const targetTab = previewTabs.find(tab => isSamePath(tab.path, path));
    if (targetTab?.isDirty) {
      const shouldClose = openConfirm
        ? await openConfirm({
          title: "Discard unsaved changes?",
          message: "Close this tab and discard unsaved changes?",
          tone: "warning",
          confirmLabel: "Close tab",
          cancelLabel: "Cancel",
        })
        : true;
      if (!shouldClose) return;
    }
    onClosePreviewTab?.(path);
  }, [onClosePreviewTab, openConfirm, previewTabs]);
  const handlePreviewTabUnpin = useCallback((path) => {
    onUpdatePreviewTab?.(path, { isEphemeral: false });
  }, [onUpdatePreviewTab]);
  const hasUnsavedPreviewChanges = previewTabs.some(tab => tab.isDirty);

  useEffect(() => {
    onPaneDirtyStateChange?.({
      hasUnsavedChanges: hasUnsavedPreviewChanges,
      scope: "preview-text",
      message: hasUnsavedPreviewChanges
        ? "One or more preview tabs have unsaved text changes."
        : "",
    });
  }, [hasUnsavedPreviewChanges, onPaneDirtyStateChange]);

  useEffect(() => () => {
    onPaneDirtyStateChange?.({
      hasUnsavedChanges: false,
      scope: "preview-text",
      message: "",
    });
  }, [onPaneDirtyStateChange]);

  return {
    mediaPreviewSrc,
    isDropOver: (isDropOver && isPanelsDragActive) || isExternalDragOver,
    isPanelsDragActive,
    isTextEditable,
    isTextPreviewReady,
    previewTabs,
    previewLabel,
    previewPath,
    previewState,
    saveStatus,
    saveStatusMessage,
    setDropNodeRef: setPanelNodeRef,
    textContent,
    handlePreviewTabActivate,
    handlePreviewTabClose,
    handlePreviewTabUnpin,
    handleSaveNow,
    handleTextContentChange,
  };
}

export default usePreviewPanelState;
