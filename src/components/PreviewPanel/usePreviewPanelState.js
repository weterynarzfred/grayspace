import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelsDndHandlers } from "../PanelsDndLayer";
import { getFirstDraggedPathFromDndEvent } from "../dndEventPaths";
import {
  getErrorMessage,
  getPathDisplayName,
  getSaveStatusMessage,
  getSelectedPreviewPath,
  INITIAL_PREVIEW_STATE,
  isFolderPreviewErrorMessage,
} from "./previewPanelUtils";

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
  const [previewState, setPreviewState] = useState(INITIAL_PREVIEW_STATE);
  const latestSaveRequestRef = useRef(0);
  const latestPreviewPathRef = useRef(selectedPreviewPath);
  const isLocked = Boolean(lockedPath);
  const shouldAutoLockToCurrentPath =
    !isLocked
    && saveStatus === "dirty"
    && latestPreviewPathRef.current
    && selectedPreviewPath !== latestPreviewPathRef.current;
  const previewPath = isLocked
    ? lockedPath
    : (shouldAutoLockToCurrentPath ? latestPreviewPathRef.current : selectedPreviewPath);
  const previewDropId = useMemo(() => `preview-drop:${paneId || "preview"}`, [paneId]);
  const previewLabel = useMemo(() => getPathDisplayName(previewPath), [previewPath]);
  const imagePreviewSrc = useMemo(() => {
    if (previewState.status !== "ready" || previewState.preview?.kind !== "image") return null;
    if (!previewPath) return null;
    return convertFileSrc(previewPath);
  }, [previewPath, previewState]);
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

  useEffect(() => {
    latestPreviewPathRef.current = previewPath;
  }, [previewPath]);

  useEffect(() => {
    if (!shouldAutoLockToCurrentPath || isLocked) return;
    setLockedPath(latestPreviewPathRef.current);
  }, [isLocked, shouldAutoLockToCurrentPath]);

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
  }, [previewPath]);

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
    imagePreviewSrc,
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
