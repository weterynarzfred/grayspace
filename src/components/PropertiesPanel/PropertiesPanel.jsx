import { useDroppable } from "@dnd-kit/core";
import { useCallback, useMemo, useState } from "react";
import { usePanelsDndHandlers } from "../PanelsDndLayer";
import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import { getFirstDraggedPathFromDndEvent } from "../dndEventPaths";
import { getPrimarySelectedPath, getSelectedPathsFromState } from "../../utils/pathSelection";
import styles from "./PropertiesPanel.module.scss";

function getPathDisplayName(path) {
  if (typeof path !== "string" || !path) return "";

  const trimmedPath = path.replace(/[\\/]+$/, "");
  if (!trimmedPath) return path;

  const pathSegments = trimmedPath.split(/[\\/]/);
  return pathSegments[pathSegments.length - 1] ?? trimmedPath;
}

function PropertiesPanel({
  paneId = "",
  panelType = "Properties",
  onPanelTypeChange = undefined,
  tabSelectedFiles = undefined,
}) {
  const selectedPropertiesPath = useMemo(
    () => getPrimarySelectedPath(getSelectedPathsFromState(tabSelectedFiles)),
    [tabSelectedFiles],
  );
  const [lockedPath, setLockedPath] = useState("");
  const isLocked = Boolean(lockedPath);
  const propertiesPath = isLocked ? lockedPath : selectedPropertiesPath;
  const propertiesLabel = useMemo(() => getPathDisplayName(propertiesPath), [propertiesPath]);
  const propertiesDropId = useMemo(
    () => `properties-drop:${paneId || "properties"}`,
    [paneId],
  );
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

  const handleToggleLock = useCallback(() => {
    if (isLocked) {
      setLockedPath("");
      return;
    }

    if (!propertiesPath) return;
    setLockedPath(propertiesPath);
  }, [isLocked, propertiesPath]);

  const handleDropPath = useCallback((droppedPath) => {
    if (!droppedPath) return;
    setLockedPath(droppedPath);
  }, []);

  usePanelsDndHandlers({
    onDragEnd: (event) => {
      if (event?.over?.id !== propertiesDropId) return;
      handleDropPath(getFirstDraggedPathFromDndEvent(event));
    },
  });

  return (
    <section
      ref={setDropNodeRef}
      className={`${shellStyles.panelContent} ${styles.panelContent} ${isDropOver ? styles.panelDropTarget : ""}`}
      aria-label="Properties panel"
    >
      <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange}>
        {propertiesLabel ? <p className={styles.pathLabel}>
          {isLocked ? propertiesLabel : <em>{propertiesLabel}</em>}
        </p> : (
          <p className={styles.muted}>Select a file to inspect.</p>
        )}
        {propertiesPath ? <button
          type="button"
          className={`${styles.lockButton} ${isLocked ? styles.lockButtonLocked : ""}`}
          onClick={handleToggleLock}
        >{isLocked ? "unlock" : "lock"}</button> : null}
      </PanelHeader>
      <div className={shellStyles.panelBody}>
        {propertiesPath ? (
          <p className={styles.pathValue} title={propertiesPath}>{propertiesPath}</p>
        ) : (
          <p className={styles.muted}>No file selected.</p>
        )}
      </div>
    </section>
  );
}

export default PropertiesPanel;
