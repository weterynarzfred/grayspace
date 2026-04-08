import { act, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import useTerminalSession from "./useTerminalSession";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

const fitAddonInstances = [];

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    constructor() {
      this.fit = vi.fn();
      fitAddonInstances.push(this);
    }
  },
}));

const terminalInstances = [];

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    constructor() {
      this.cols = 80;
      this.rows = 24;
      this.loadAddon = vi.fn();
      this.open = vi.fn();
      this.write = vi.fn();
      this.dispose = vi.fn();
      this.onData = vi.fn((handler) => {
        this.onDataHandler = handler;
        this.dataSubscriptionDispose = vi.fn();
        return { dispose: this.dataSubscriptionDispose };
      });
      terminalInstances.push(this);
    }
  },
}));

function TerminalHookHarness({ cwdHint = "", sessionId = "term-1" }) {
  const { terminalHostRef, status } = useTerminalSession(cwdHint, sessionId);

  return <>
    <div data-testid="terminal-host" ref={terminalHostRef} />
    <p data-testid="terminal-status">{status}</p>
  </>;
}

describe("useTerminalSession", () => {
  let unlistenOutput;
  let unlistenExit;
  let terminalOutputListener;
  let terminalExitListener;
  let resizeObserverInstance;

  beforeEach(() => {
    invoke.mockClear();
    invoke.mockResolvedValue(null);
    listen.mockClear();
    fitAddonInstances.length = 0;
    terminalInstances.length = 0;

    terminalOutputListener = undefined;
    terminalExitListener = undefined;
    unlistenOutput = vi.fn();
    unlistenExit = vi.fn();

    listen.mockImplementation(async (eventName, handler) => {
      if (eventName === "terminal-output") {
        terminalOutputListener = handler;
        return unlistenOutput;
      }
      if (eventName === "terminal-exit") {
        terminalExitListener = handler;
        return unlistenExit;
      }
      return vi.fn();
    });

    resizeObserverInstance = undefined;
    globalThis.ResizeObserver = class {
      constructor(callback) {
        this.callback = callback;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        resizeObserverInstance = this;
      }
    };
  });

  it("starts terminal sessions and wires listeners", async () => {
    render(<TerminalHookHarness cwdHint="C:\\Users" />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "terminal_start",
        expect.objectContaining({
          sessionId: "term-1",
          cwd: expect.stringContaining("Users"),
          cols: 80,
          rows: 24,
        }),
      );
    });

    expect(listen).toHaveBeenCalledWith("terminal-output", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("terminal-exit", expect.any(Function));
    expect(invoke).toHaveBeenCalledWith("terminal_resize", {
      sessionId: "term-1",
      cols: 80,
      rows: 24,
    });
    expect(screen.getByTestId("terminal-status")).toHaveTextContent("");

    await act(async () => {
      terminalInstances[0].onDataHandler?.("pwd\n");
    });

    expect(invoke).toHaveBeenCalledWith("terminal_write", {
      sessionId: "term-1",
      data: "pwd\n",
    });
    expect(fitAddonInstances[0].fit).toHaveBeenCalled();
    expect(resizeObserverInstance.observe).toHaveBeenCalledWith(screen.getByTestId("terminal-host"));
  });

  it("writes only output for the active session id", async () => {
    render(<TerminalHookHarness sessionId="term-1" />);

    await waitFor(() => {
      expect(typeof terminalOutputListener).toBe("function");
    });

    await act(async () => {
      terminalOutputListener({
        payload: {
          sessionId: "other-session",
          data: "ignored",
        },
      });
    });

    expect(terminalInstances[0].write).not.toHaveBeenCalled();

    await act(async () => {
      terminalOutputListener({
        payload: {
          sessionId: "term-1",
          data: "hello",
        },
      });
    });

    expect(terminalInstances[0].write).toHaveBeenCalledWith("hello");
  });

  it("marks the session disconnected when receiving a matching terminal-exit event", async () => {
    render(<TerminalHookHarness sessionId="term-1" />);

    await waitFor(() => {
      expect(typeof terminalExitListener).toBe("function");
    });

    await act(async () => {
      terminalExitListener({
        payload: {
          sessionId: "term-1",
        },
      });
    });

    expect(screen.getByTestId("terminal-status")).toHaveTextContent("Terminal session ended.");
  });

  it("syncs cwd only after connection and reports sync failures", async () => {
    invoke.mockImplementation(async (commandName) => {
      if (commandName === "terminal_set_cwd") throw new Error("cannot cd");
      return null;
    });

    const { rerender } = render(<TerminalHookHarness cwdHint="C:\\Users" sessionId="term-1" />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "terminal_start",
        expect.objectContaining({ cwd: expect.stringContaining("Users") }),
      );
    });

    rerender(<TerminalHookHarness cwdHint="D:\\Projects" sessionId="term-1" />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("terminal_set_cwd", {
        sessionId: "term-1",
        path: expect.stringContaining("Projects"),
      });
    });
    expect(screen.getByTestId("terminal-status")).toHaveTextContent("Failed to sync directory: cannot cd");
  });

  it("shows a startup error when terminal_start fails", async () => {
    invoke.mockImplementation(async (commandName) => {
      if (commandName === "terminal_start") throw "spawn failed";
      return null;
    });

    render(<TerminalHookHarness sessionId="term-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("terminal-status")).toHaveTextContent(
        "Failed to start terminal: spawn failed",
      );
    });
  });

  it("shows an initialization error when listener registration fails", async () => {
    listen.mockRejectedValueOnce(new Error("listen failed"));

    render(<TerminalHookHarness sessionId="term-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("terminal-status")).toHaveTextContent(
        "Failed to initialize terminal listeners: listen failed",
      );
    });
  });

  it("marks status unavailable when there is no session id", async () => {
    render(<TerminalHookHarness sessionId="" />);

    await waitFor(() => {
      expect(screen.getByTestId("terminal-status")).toHaveTextContent("Terminal session unavailable.");
    });

    expect(invoke).not.toHaveBeenCalledWith("terminal_start", expect.any(Object));
  });

  it("re-synchronizes terminal dimensions when resize observer fires", async () => {
    render(<TerminalHookHarness sessionId="term-1" />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "terminal_resize",
        expect.objectContaining({ sessionId: "term-1" }),
      );
    });

    const resizeCallCount = invoke.mock.calls.filter(([commandName]) => commandName === "terminal_resize").length;

    await act(async () => {
      resizeObserverInstance.callback();
    });

    await waitFor(() => {
      const updatedCallCount = invoke.mock.calls.filter(([commandName]) => commandName === "terminal_resize").length;
      expect(updatedCallCount).toBeGreaterThan(resizeCallCount);
    });
  });

  it("cleans up subscriptions and listeners on unmount", async () => {
    const { unmount } = render(<TerminalHookHarness cwdHint="C:\\Users" />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "terminal_start",
        expect.objectContaining({ sessionId: "term-1" }),
      );
    });

    unmount();

    expect(terminalInstances[0].dataSubscriptionDispose).toHaveBeenCalledTimes(1);
    expect(resizeObserverInstance.disconnect).toHaveBeenCalledTimes(1);
    expect(unlistenOutput).toHaveBeenCalledTimes(1);
    expect(unlistenExit).toHaveBeenCalledTimes(1);
    expect(terminalInstances[0].dispose).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalledWith(
      "terminal_stop",
      expect.objectContaining({ sessionId: "term-1" }),
    );
  });
});
