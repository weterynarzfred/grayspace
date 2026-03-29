import { useDroppable } from "@dnd-kit/core";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useMemo } from "react";
import { usePanelsDndHandlers } from "../PanelsDndLayer";
import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import { getDraggedPathsFromDndEvent } from "../dndEventPaths";
import styles from "./TerminalPanel.module.scss";
import useTerminalSession from "./hooks/useTerminalSession";
import "@xterm/xterm/css/xterm.css";

function pathForShell(path) {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  const driveMatch = normalized.match(/^([A-Za-z]):(.*)$/);
  if (!driveMatch) return normalized;

  const driveLetter = driveMatch[1].toLowerCase();
  const rest = driveMatch[2].replace(/^\/+/, "");
  return rest ? `/${driveLetter}/${rest}` : `/${driveLetter}`;
}

function escapeSingleQuotes(value) {
  return value.replace(/'/g, "'\\''");
}

function formatTerminalDropPaths(paths) {
  const normalizedPaths = Array.isArray(paths) ? paths : [];
  return normalizedPaths
    .map((path) => `'${escapeSingleQuotes(pathForShell(path))}'`)
    .join(" ");
}

function TerminalPanel({
  paneId = "",
  panelType = "Terminal",
  onPanelTypeChange = undefined,
  cwdHint = "",
  terminalSessionId = "",
}) {
  const { terminalHostRef, status } = useTerminalSession(cwdHint, terminalSessionId);
  const terminalDropId = useMemo(
    () => `terminal-drop:${paneId || "terminal"}`,
    [paneId],
  );
  const {
    isOver: isDropOver,
    setNodeRef: setDropNodeRef,
  } = useDroppable({
    id: terminalDropId,
    data: {
      kind: "terminal",
      paneId,
    },
  });

  const handleDropPaths = useCallback(async (droppedPaths) => {
    if (!terminalSessionId) return;

    const formattedPaths = formatTerminalDropPaths(droppedPaths);
    if (!formattedPaths) return;
    try {
      await invoke("terminal_write", {
        sessionId: terminalSessionId,
        data: formattedPaths,
      });
    } catch {
      // Terminal status already surfaces runtime errors.
    }
  }, [terminalSessionId]);

  usePanelsDndHandlers({
    onDragEnd: (event) => {
      if (event?.over?.id !== terminalDropId) return;
      void handleDropPaths(getDraggedPathsFromDndEvent(event));
    },
  });

  return <section
    ref={setDropNodeRef}
    className={`${shellStyles.panelContent} ${styles.panelContent} ${isDropOver ? styles.panelDropTarget : ""}`}
    aria-label="Terminal panel"
  >
    <PanelHeader panelType={panelType} onPanelTypeChange={onPanelTypeChange}>
      <span className={styles.cwdLabel} title={cwdHint || "No folder selected"}>
        {cwdHint || "No folder selected"}
      </span>
    </PanelHeader>
    <div className={styles.panelBody}>
      {status ? <p className={styles.status}>{status}</p> : null}
      <div className={styles.terminalFrame}>
        <div ref={terminalHostRef} className={styles.terminalHost} />
      </div>
    </div>
  </section>;
}

export default TerminalPanel;
