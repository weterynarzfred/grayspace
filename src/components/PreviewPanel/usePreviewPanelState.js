import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelsDndHandlers } from "../PanelsDndLayer";
import { getFirstDraggedPathFromDndEvent } from "../dndEventPaths";
import useFilesystemDirectoryWatcher from "../FilesystemPanel/hooks/useFilesystemDirectoryWatcher";
import { getParentDirectoryPath, isSamePath } from "../../utils/pathWatch";
import {
  getErrorMessage,
  getPathDisplayName,
  getSaveStatusMessage,
  getSelectedPreviewPath,
  INITIAL_PREVIEW_STATE,
  isFolderPreviewErrorMessage,
} from "./previewPanelUtils";

function isMediaPreviewKind(kind) {
  return kind === "image" || kind === "audio" || kind === "video";
}

function appendCacheBuster(src, token) {
  if (!src) return src;
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}v=${token}`;
}

function usePreviewPanelState({
  paneId = "",
  tabSelectedFiles = undefined,
  onPaneDirtyStateChange = undefined,
}) {
  const selectedPreviewPath = useMemo(
    () => getSelectedPreviewPath(tabSelectedFiles),
    [tabSelectedFiles],
  );
  const [lockedPath, setLockedPath] = useState("");
  const [textContent, setTextContent] = useState("");
  const [saveStatus, setSaveStatus] = useState("idle");
  const [saveError, setSaveError] = useState("");
  const [previewReloadVersion, setPreviewReloadVersion] = useState(0);
  const [mediaSrcVersion, setMediaSrcVersion] = useState(0);
  const [previewState, setPreviewState] = useState(INITIAL_PREVIEW_STATE);
  const latestSaveRequestRef = useRef(0);
  const latestPreviewPathRef = useRef(selectedPreviewPath);
  const isLocked = Boolean(lockedPath);
  const previousPreviewPath = latestPreviewPathRef.current;
  const shouldStickToPreviousPath =
    !isLocked
    && saveStatus === "dirty"
    && previousPreviewPath
    && selectedPreviewPath !== previousPreviewPath;
  const previewPath = isLocked
    ? lockedPath
    : (shouldStickToPreviousPath ? previousPreviewPath : selectedPreviewPath);
  const previewDropId = useMemo(() => `preview-drop:${paneId || "preview"}`, [paneId]);
  const previewLabel = useMemo(() => getPathDisplayName(previewPath), [previewPath]);
  const previewDirectoryPath = useMemo(() => getParentDirectoryPath(previewPath), [previewPath]);
  const mediaPreviewSrc = useMemo(() => {
    if (previewState.status !== "ready") return null;
    const previewKind = previewState.preview?.kind;
    if (!isMediaPreviewKind(previewKind)) return null;
    if (!previewPath) return null;
    return appendCacheBuster(convertFileSrc(previewPath), mediaSrcVersion);
  }, [mediaSrcVersion, previewPath, previewState]);
  const isTextPreviewReady = previewState.status === "ready" && previewState.preview?.kind === "text";
  const isTextEditable = isTextPreviewReady && !previewState.preview?.truncated;
  const hasUnsavedPreviewChanges = isTextEditable && saveStatus === "dirty";

  const saveTextFile = useCallback(async (path, content) => {
    const requestId = latestSaveRequestRef.current + 1;
    latestSaveRequestRef.current = requestId;
    setSaveStatus("saving");
    setSaveError("");

    try {
      await invoke("preview_write_text_file", { path, content });
      if (latestSaveRequestRef.current !== requestId) return;
      setSaveStatus("saved");
    } catch (saveLoadError) {
      if (latestSaveRequestRef.current !== requestId) return;
      setSaveStatus("error");
      setSaveError(getErrorMessage(saveLoadError));
    }
  }, []);

  const handleToggleLock = useCallback(() => {
    if (isLocked) {
      const willSwitchToSelectedPath =
        selectedPreviewPath
        && selectedPreviewPath !== lockedPath
        && saveStatus === "dirty";
      if (willSwitchToSelectedPath) {
        setSaveStatus("idle");
        setSaveError("");
      }
      setLockedPath("");
      return;
    }

    if (!previewPath) return;
    setLockedPath(previewPath);
  }, [isLocked, lockedPath, previewPath, saveStatus, selectedPreviewPath]);

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

  usePanelsDndHandlers({
    onDragEnd: (event) => {
      if (event?.over?.id !== previewDropId) return;
      const droppedPath = getFirstDraggedPathFromDndEvent(event);
      if (!droppedPath) return;
      setLockedPath(droppedPath);
    },
  });

  const handlePreviewFileWatchChange = useCallback((_watchedPath, changedPath) => {
    if (!previewPath) return;
    if (saveStatus === "dirty" || saveStatus === "saving") return;

    const hasKnownPath = typeof changedPath === "string" && changedPath.length > 0;
    const isPreviewPathChange = hasKnownPath && isSamePath(changedPath, previewPath);
    const isDirectoryLevelChange = hasKnownPath
      && previewDirectoryPath
      && isSamePath(changedPath, previewDirectoryPath);
    if (hasKnownPath && !isPreviewPathChange && !isDirectoryLevelChange) return;

    setPreviewReloadVersion(version => version + 1);
  }, [previewDirectoryPath, previewPath, saveStatus]);

  useFilesystemDirectoryWatcher({
    watchPaths: previewDirectoryPath ? [previewDirectoryPath] : [],
    onDirectoryChange: handlePreviewFileWatchChange,
  });

  useEffect(() => {
    latestPreviewPathRef.current = previewPath;
  }, [previewPath]);

  useEffect(() => {
    if (!shouldStickToPreviousPath || isLocked) return;
    setLockedPath(latestPreviewPathRef.current);
  }, [isLocked, shouldStickToPreviousPath]);

  const handleTextContentChange = useCallback((nextContent) => {
    if (!isTextEditable || !previewPath) return;

    setTextContent(nextContent);
    setSaveStatus("dirty");
    setSaveError("");
  }, [
    isTextEditable,
    previewPath,
  ]);

  const handleSaveNow = useCallback(() => {
    if (!isTextEditable || !previewPath) return;
    void saveTextFile(previewPath, textContent);
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
    setSaveStatus("idle");
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
          setTextContent(preview.content);
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
    return () => {
      cancelled = true;
    };
  }, [previewPath, previewReloadVersion]);

  const saveStatusMessage = useMemo(() => getSaveStatusMessage({
    isTextPreviewReady,
    isTextEditable,
    saveStatus,
    saveError,
  }), [isTextEditable, isTextPreviewReady, saveError, saveStatus]);

  useEffect(() => {
    if (typeof onPaneDirtyStateChange !== "function") return;

    onPaneDirtyStateChange({
      hasUnsavedChanges: hasUnsavedPreviewChanges,
      scope: "preview-text",
      message: hasUnsavedPreviewChanges
        ? "This preview has unsaved text changes."
        : "",
    });
  }, [hasUnsavedPreviewChanges, onPaneDirtyStateChange]);

  useEffect(() => () => {
    if (typeof onPaneDirtyStateChange !== "function") return;
    onPaneDirtyStateChange({
      hasUnsavedChanges: false,
      scope: "preview-text",
      message: "",
    });
  }, [onPaneDirtyStateChange]);

  return {
    mediaPreviewSrc,
    isDropOver,
    isLocked,
    isTextEditable,
    isTextPreviewReady,
    previewLabel,
    previewPath,
    previewState,
    saveStatus,
    saveStatusMessage,
    setDropNodeRef,
    textContent,
    handleSaveNow,
    handleTextContentChange,
    handleToggleLock,
  };
}

export default usePreviewPanelState;
