import { invoke } from "@tauri-apps/api/core";
import { useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelsDndHandlers, usePanelsDragActive } from "../PanelsDndLayer";
import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import { getFirstDraggedPathFromDndEvent } from "../dndEventPaths";
import useExternalPathDrop from "../hooks/useExternalPathDrop";
import useFilesystemDirectoryWatcher from "../FilesystemPanel/hooks/useFilesystemDirectoryWatcher";
import { getPrimarySelectedPath, getSelectedPathsFromState, uniqueNonEmptyPaths } from "../../utils/pathSelection";
import { getParentDirectoryPath, isSamePath } from "../../utils/pathWatch";
import styles from "./PropertiesPanel.module.scss";

const INITIAL_DETAILS_STATE = {
  status: "idle",
  details: null,
  error: "",
};

function getPathDisplayName(path) {
  if (typeof path !== "string" || !path) return "";
  const trimmedPath = path.replace(/[\\/]+$/, "");
  if (!trimmedPath) return path;
  const pathSegments = trimmedPath.split(/[\\/]/);
  return pathSegments.at(-1) ?? trimmedPath;
}

function getErrorMessage(error) {
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  return "Failed to load properties.";
}

function formatSize(sizeBytes) {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) return "Unknown";
  if (sizeBytes === 1) return "1 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  let maximumFractionDigits = 2;
  if (value >= 100 || unitIndex === 0) maximumFractionDigits = 0;
  else if (value >= 10) maximumFractionDigits = 1;
  return `${value.toLocaleString(undefined, { maximumFractionDigits })} ${units[unitIndex]}`;
}

function usePropertiesDetails(propertiesPath, detailsReloadVersion) {
  const [detailsState, setDetailsState] = useState(INITIAL_DETAILS_STATE);

  useEffect(() => {
    if (!propertiesPath) {
      setDetailsState(INITIAL_DETAILS_STATE);
      return undefined;
    }

    let cancelled = false;
    setDetailsState({ status: "loading", details: null, error: "" });

    invoke("filesystem_get_properties", { path: propertiesPath })
      .then((details) => {
        if (!cancelled) setDetailsState({ status: "ready", details, error: "" });
      })
      .catch((loadError) => {
        if (!cancelled) setDetailsState({ status: "error", details: null, error: getErrorMessage(loadError) });
      });

    return () => { cancelled = true; };
  }, [propertiesPath, detailsReloadVersion]);

  return detailsState;
}

function formatDate(timestampMs) {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || timestampMs <= 0) return "Unknown";
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function renderPropertiesHeaderLabel(propertiesLabel, isLocked) {
  if (propertiesLabel) {
    return <p className={styles.pathLabel}>{isLocked ? propertiesLabel : <em>{propertiesLabel}</em>}</p>;
  }
  return <p className={styles.muted}>Select a file to inspect.</p>;
}

function renderPropertiesLockButton(propertiesPath, isLocked, handleToggleLock) {
  if (!propertiesPath) return null;
  return <button
    type="button"
    className={`${styles.lockButton} ${isLocked ? styles.lockButtonLocked : ""}`}
    onClick={handleToggleLock}
  >{isLocked ? "unlock" : "lock"}</button>;
}

function renderPropertiesBody(propertiesPath, detailsState, detailsRows) {
  if (!propertiesPath) return <p className={styles.muted}>No file selected.</p>;
  return <>
    <p className={styles.pathValue} title={propertiesPath}>{propertiesPath}</p>
    {detailsState.status === "loading" ? <p className={styles.muted}>Loading properties...</p> : null}
    {detailsState.status === "error" ? <p className={styles.error}>{detailsState.error}</p> : null}
    {detailsState.status === "ready" ? <dl className={styles.detailsList}>
      {detailsRows.map(({ key, value }) => <div key={key} className={styles.detailRow}>
        <dt className={styles.detailKey}>{key}</dt>
        <dd className={styles.detailValue}>{value}</dd>
      </div>)}
    </dl> : null}
  </>;
}

function PropertiesPanel({
  paneId = "",
  panelType = "Properties",
  onPanelTypeChange = undefined,
  tabSelectedFiles = undefined,
}) {
  const selectedPropertiesPath = getPrimarySelectedPath(getSelectedPathsFromState(tabSelectedFiles));
  const [lockedPath, setLockedPath] = useState("");
  const [detailsReloadVersion, setDetailsReloadVersion] = useState(0);
  const isLocked = Boolean(lockedPath);
  const propertiesPath = isLocked ? lockedPath : selectedPropertiesPath;
  const propertiesLabel = useMemo(() => getPathDisplayName(propertiesPath), [propertiesPath]);
  const propertiesDirectoryPath = useMemo(() => getParentDirectoryPath(propertiesPath), [propertiesPath]);
  const propertiesDropId = `properties-drop:${paneId || "properties"}`;
  const {
    isOver: isDropOver,
    setNodeRef: setDropNodeRef,
  } = useDroppable({
    id: propertiesDropId,
    data: {
      kind: "properties",
      paneId,
    },
  });
  const isPanelsDragActive = usePanelsDragActive();
  const panelRef = useRef(null);
  const setPanelNodeRef = useCallback((node) => {
    panelRef.current = node;
    setDropNodeRef(node);
  }, [setDropNodeRef]);

  const handleToggleLock = useCallback(() => {
    if (isLocked) {
      setLockedPath("");
      return;
    }
    if (!propertiesPath) return;
    setLockedPath(propertiesPath);
  }, [isLocked, propertiesPath]);

  usePanelsDndHandlers({
    onDragEnd: (event) => {
      if (event?.over?.id !== propertiesDropId) return;
      const droppedPath = getFirstDraggedPathFromDndEvent(event);
      if (!droppedPath) return;
      setLockedPath(droppedPath);
    },
  });

  const handleExternalDropPaths = useCallback((droppedPaths) => {
    const [firstPath] = uniqueNonEmptyPaths(droppedPaths);
    if (!firstPath) return;
    setLockedPath(firstPath);
  }, []);
  const { isExternalDragOver } = useExternalPathDrop({
    panelRef,
    isEnabled: true,
    onDropPaths: handleExternalDropPaths,
  });

  const handlePropertiesFileWatchChange = useCallback((_watchedPath, changedPath) => {
    if (!propertiesPath) return;

    const hasKnownPath = typeof changedPath === "string" && changedPath.length > 0;
    const isPropertiesPathChange = hasKnownPath && isSamePath(changedPath, propertiesPath);
    const isDirectoryLevelChange = hasKnownPath
      && propertiesDirectoryPath
      && isSamePath(changedPath, propertiesDirectoryPath);
    if (hasKnownPath && !isPropertiesPathChange && !isDirectoryLevelChange) return;

    setDetailsReloadVersion(version => version + 1);
  }, [propertiesDirectoryPath, propertiesPath]);

  useFilesystemDirectoryWatcher({
    watchPaths: propertiesDirectoryPath ? [propertiesDirectoryPath] : [],
    onDirectoryChange: handlePropertiesFileWatchChange,
  });

  const detailsState = usePropertiesDetails(propertiesPath, detailsReloadVersion);

  const details = detailsState.details;
  const detailsRows = [
    { key: "size", value: formatSize(details?.sizeBytes) },
    { key: "type", value: details?.entryType || "Unknown" },
    { key: "date modified", value: formatDate(details?.dateModifiedMs) },
    { key: "date created", value: formatDate(details?.dateCreatedMs) },
  ];
  const isDropTarget = (isDropOver && isPanelsDragActive) || isExternalDragOver;

  return <section
    ref={setPanelNodeRef}
    className={`${shellStyles.panelContent} ${styles.panelContent} ${isDropTarget ? styles.panelDropTarget : ""}`}
    aria-label="Properties panel"
  >
    <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange}>
      {renderPropertiesHeaderLabel(propertiesLabel, isLocked)}
      {renderPropertiesLockButton(propertiesPath, isLocked, handleToggleLock)}
    </PanelHeader>
    <div className={shellStyles.panelBody}>
      {renderPropertiesBody(propertiesPath, detailsState, detailsRows)}
    </div>
  </section>;
}

export default PropertiesPanel;
