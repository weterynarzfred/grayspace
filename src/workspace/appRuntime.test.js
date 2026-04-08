import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureWorkspaceWindowCreated,
  getErrorMessage,
  getScreenPointFromEvent,
} from "./appRuntime";

const webviewMocks = vi.hoisted(() => {
  const getByLabel = vi.fn();
  const ctor = vi.fn(function createWindow(label, options) {
    return { label, options };
  });
  ctor.getByLabel = getByLabel;
  return { getByLabel, ctor };
});

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: webviewMocks.ctor,
}));

describe("appRuntime", () => {
  beforeEach(() => {
    webviewMocks.getByLabel.mockReset();
    webviewMocks.ctor.mockClear();
  });

  describe("getErrorMessage", () => {
    it("returns Error message for Error instances", () => {
      expect(getErrorMessage(new Error("Boom"))).toBe("Boom");
    });

    it("returns raw string when error is a string", () => {
      expect(getErrorMessage("Oops")).toBe("Oops");
    });

    it("falls back to unknown message for unsupported values", () => {
      expect(getErrorMessage({ reason: "unknown" })).toBe("Unknown workspace error.");
      expect(getErrorMessage(null)).toBe("Unknown workspace error.");
    });
  });

  describe("getScreenPointFromEvent", () => {
    it("returns rounded screen coordinates from mouse-like events", () => {
      expect(getScreenPointFromEvent({ screenX: 10.6, screenY: 20.2 })).toEqual({ x: 11, y: 20 });
    });

    it("returns rounded screen coordinates from first touch entry", () => {
      expect(getScreenPointFromEvent({
        touches: [{ screenX: 18.4, screenY: 19.9 }],
      })).toEqual({ x: 18, y: 20 });
    });

    it("returns null when event does not expose coordinates", () => {
      expect(getScreenPointFromEvent(null)).toBeNull();
      expect(getScreenPointFromEvent({})).toBeNull();
      expect(getScreenPointFromEvent({ touches: [] })).toBeNull();
    });
  });

  describe("ensureWorkspaceWindowCreated", () => {
    it("throws when window label is missing", async () => {
      await expect(ensureWorkspaceWindowCreated({})).rejects.toThrow(
        "Window label is missing for creation.",
      );
    });

    it("returns existing window when label already exists", async () => {
      const existingWindow = { label: "workspace-1", reused: true };
      webviewMocks.getByLabel.mockResolvedValue(existingWindow);

      const result = await ensureWorkspaceWindowCreated({ windowLabel: "workspace-1" });

      expect(webviewMocks.getByLabel).toHaveBeenCalledWith("workspace-1");
      expect(webviewMocks.ctor).not.toHaveBeenCalled();
      expect(result).toBe(existingWindow);
    });

    it("creates a new window with expected defaults when none exists", async () => {
      webviewMocks.getByLabel.mockResolvedValue(null);

      const result = await ensureWorkspaceWindowCreated({
        windowLabel: "workspace-new",
        bounds: {
          x: 100,
          y: 200,
          width: 1200,
          height: 800,
        },
      });

      expect(webviewMocks.ctor).toHaveBeenCalledWith("workspace-new", {
        url: window.location.href,
        title: "grayspace",
        decorations: false,
        shadow: false,
        x: 100,
        y: 200,
        width: 1200,
        height: 800,
      });
      expect(result).toEqual(expect.objectContaining({ label: "workspace-new" }));
    });

    it("ignores non-numeric bounds when creating a window", async () => {
      webviewMocks.getByLabel.mockResolvedValue(null);

      await ensureWorkspaceWindowCreated({
        windowLabel: "workspace-new",
        bounds: {
          x: "100",
          y: null,
          width: undefined,
          height: "800",
        },
      });

      expect(webviewMocks.ctor).toHaveBeenCalledWith("workspace-new", expect.objectContaining({
        x: undefined,
        y: undefined,
        width: undefined,
        height: undefined,
      }));
    });
  });
});
