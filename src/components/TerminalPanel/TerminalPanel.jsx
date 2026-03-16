import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import PanelHeader from "../PanelHeader";
import shellStyles from "../PanelShell.module.scss";
import styles from "./TerminalPanel.module.scss";
import "@xterm/xterm/css/xterm.css";

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown terminal error.";
}

function TerminalPanel({
  panelType = "Terminal",
  onPanelTypeChange = undefined,
  cwdHint = "",
}) {
  const terminalHostRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const lastSyncedCwdRef = useRef("");
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState("Starting Git Bash...");

  useEffect(() => {
    if (!terminalHostRef.current) {
      return undefined;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "\"Fira Code\", monospace",
      fontSize: 12,
      lineHeight: 1,
      theme: {
        background: "transparent",
        foreground: "#eee",
        cursor: "#ccc",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    let isDisposed = false;
    let unlistenOutput = null;
    let unlistenExit = null;
    let dataSubscription = null;
    let resizeObserver = null;

    const syncSize = async () => {
      if (isDisposed || !terminalRef.current || !fitAddonRef.current) {
        return;
      }

      fitAddonRef.current.fit();
      const cols = Math.max(terminalRef.current.cols, 2);
      const rows = Math.max(terminalRef.current.rows, 1);
      await invoke("terminal_resize", { cols, rows }).catch(() => { });
    };

    const startSession = async () => {
      try {
        const cols = Math.max(terminal.cols, 2);
        const rows = Math.max(terminal.rows, 1);

        await invoke("terminal_start", {
          cwd: cwdHint || null,
          cols,
          rows,
        });

        if (cwdHint) {
          lastSyncedCwdRef.current = cwdHint;
        }

        setIsConnected(true);
        setStatus("");

        dataSubscription = terminal.onData((data) => {
          invoke("terminal_write", { data }).catch(() => { });
        });

        await syncSize();
      } catch (error) {
        const message = getErrorMessage(error);
        setStatus(`Failed to start terminal: ${message}`);
      }
    };

    const initialize = async () => {
      unlistenOutput = await listen("terminal-output", (event) => {
        const data = event.payload?.data;
        if (typeof data === "string" && terminalRef.current) {
          terminalRef.current.write(data);
        }
      });

      unlistenExit = await listen("terminal-exit", () => {
        setIsConnected(false);
        setStatus("Terminal session ended.");
      });

      if (isDisposed) {
        unlistenOutput?.();
        unlistenExit?.();
        return;
      }

      await startSession();

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          syncSize().catch(() => { });
        });
        resizeObserver.observe(terminalHostRef.current);
      }
    };

    initialize().catch((error) => {
      setStatus(`Failed to initialize terminal listeners: ${getErrorMessage(error)}`);
    });

    return () => {
      isDisposed = true;
      setIsConnected(false);

      if (dataSubscription) {
        dataSubscription.dispose();
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (unlistenOutput) {
        unlistenOutput();
      }
      if (unlistenExit) {
        unlistenExit();
      }

      invoke("terminal_stop").catch(() => { });

      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      lastSyncedCwdRef.current = "";
    };
  }, []);

  useEffect(() => {
    if (!isConnected || !cwdHint || cwdHint === lastSyncedCwdRef.current)
      return;

    invoke("terminal_set_cwd", { path: cwdHint })
      .then(() => {
        lastSyncedCwdRef.current = cwdHint;
      })
      .catch((error) => {
        setStatus(`Failed to sync directory: ${getErrorMessage(error)}`);
      });
  }, [cwdHint, isConnected]);

  return (
    <section
      className={`${shellStyles.panelContent} ${styles.panelContent}`}
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
    </section>
  );
}

export default TerminalPanel;
