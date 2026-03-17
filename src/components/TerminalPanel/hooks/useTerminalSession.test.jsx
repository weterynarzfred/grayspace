import { render, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import useTerminalSession from "./useTerminalSession";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    constructor() {
      this.cols = 80;
      this.rows = 24;
    }
    loadAddon() {}
    open() {}
    onData() {
      return { dispose: () => {} };
    }
    write() {}
    dispose() {}
  },
}));

function TerminalHookHarness({ cwdHint = "", sessionId = "term-1" }) {
  const { terminalHostRef } = useTerminalSession(cwdHint, sessionId);

  return <div ref={terminalHostRef} />;
}

describe("useTerminalSession", () => {
  beforeEach(() => {
    invoke.mockClear();
    if (typeof ResizeObserver === "undefined") {
      globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
    }
  });

  it("does not stop terminal sessions on component unmount", async () => {
    const { unmount } = render(<TerminalHookHarness cwdHint="C:\\Users" />);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "terminal_start",
        expect.objectContaining({ sessionId: "term-1" }),
      );
    });

    unmount();

    expect(invoke).not.toHaveBeenCalledWith(
      "terminal_stop",
      expect.objectContaining({ sessionId: "term-1" }),
    );
  });
});
