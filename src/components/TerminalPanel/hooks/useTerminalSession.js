import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown terminal error.";
}

function useTerminalSession(cwdHint = "", sessionId = "") {
  const terminalHostRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const lastSyncedCwdRef = useRef("");
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState("Starting Git Bash...");

  useEffect(() => {
    if (!terminalHostRef.current) return undefined;
    if (!sessionId) {
      setStatus("Terminal session unavailable.");
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
      if (isDisposed || !terminalRef.current || !fitAddonRef.current) return;

      fitAddonRef.current.fit();
      const cols = Math.max(terminalRef.current.cols, 2);
      const rows = Math.max(terminalRef.current.rows, 1);
      await invoke("terminal_resize", { sessionId, cols, rows }).catch(() => { });
    };

    const startSession = async () => {
      try {
        const cols = Math.max(terminal.cols, 2);
        const rows = Math.max(terminal.rows, 1);

        await invoke("terminal_start", {
          sessionId,
          cwd: cwdHint || null,
          cols,
          rows,
        });

        if (cwdHint) lastSyncedCwdRef.current = cwdHint;

        setIsConnected(true);
        setStatus("");

        dataSubscription = terminal.onData(data => {
          invoke("terminal_write", { sessionId, data }).catch(() => { });
        });

        await syncSize();
      } catch (error) {
        const message = getErrorMessage(error);
        setStatus(`Failed to start terminal: ${message}`);
      }
    };

    const initialize = async () => {
      unlistenOutput = await listen("terminal-output", event => {
        if (event.payload?.sessionId !== sessionId) return;
        const data = event.payload?.data;
        if (typeof data === "string" && terminalRef.current)
          terminalRef.current.write(data);
      });

      unlistenExit = await listen("terminal-exit", event => {
        if (event.payload?.sessionId !== sessionId) return;
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

    initialize().catch(error => {
      setStatus(`Failed to initialize terminal listeners: ${getErrorMessage(error)}`);
    });

    return () => {
      isDisposed = true;
      setIsConnected(false);

      if (dataSubscription) dataSubscription.dispose();
      if (resizeObserver) resizeObserver.disconnect();
      if (unlistenOutput) unlistenOutput();
      if (unlistenExit) unlistenExit();

      invoke("terminal_stop", { sessionId }).catch(() => { });

      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      lastSyncedCwdRef.current = "";
    };
  }, [sessionId]);

  useEffect(() => {
    if (!isConnected || !cwdHint || cwdHint === lastSyncedCwdRef.current) return;

    invoke("terminal_set_cwd", { sessionId, path: cwdHint })
      .then(() => {
        lastSyncedCwdRef.current = cwdHint;
      })
      .catch(error => {
        setStatus(`Failed to sync directory: ${getErrorMessage(error)}`);
      });
  }, [cwdHint, isConnected, sessionId]);

  return { terminalHostRef, status };
}

export default useTerminalSession;
