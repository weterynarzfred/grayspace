import { renderHook, waitFor } from "@testing-library/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import useWorkspaceLifecycle, { BOUNDS_SYNC_DELAY_MS } from "./useWorkspaceLifecycle";
import { listenWorkspaceUpdated, workspaceBootstrap, workspaceSetWindowBounds } from "./workspaceApi";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

vi.mock("./workspaceApi", () => ({
  listenWorkspaceUpdated: vi.fn(),
  workspaceBootstrap: vi.fn(),
  workspaceSetWindowBounds: vi.fn(),
}));

const currentWindowIdRef = { current: "window-1" };
let appWindow;
let emitMoved;
let emitResized;

function renderLifecycle() {
  return renderHook(() => useWorkspaceLifecycle({ dispatch: vi.fn(), currentWindowIdRef }));
}

describe("useWorkspaceLifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appWindow = {
      label: "main",
      outerPosition: vi.fn(async () => ({ x: -1200, y: 150 })),
      innerSize: vi.fn(async () => ({ width: 900, height: 700 })),
      isMaximized: vi.fn(async () => false),
      isMinimized: vi.fn(async () => false),
      onMoved: vi.fn(async (handler) => {
        emitMoved = handler;
        return () => {};
      }),
      onResized: vi.fn(async (handler) => {
        emitResized = handler;
        return () => {};
      }),
    };
    getCurrentWindow.mockReturnValue(appWindow);
    workspaceBootstrap.mockResolvedValue({ windowId: "window-1", windowLabel: "main", snapshot: null });
    workspaceSetWindowBounds.mockResolvedValue(null);
    listenWorkspaceUpdated.mockResolvedValue(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the outer position, inner size and maximized state at bootstrap", async () => {
    appWindow.isMaximized.mockResolvedValue(true);

    renderLifecycle();

    await waitFor(() => expect(workspaceSetWindowBounds).toHaveBeenCalledWith("window-1", {
      x: -1200,
      y: 150,
      width: 900,
      height: 700,
      maximized: true,
    }, false));
    expect(workspaceBootstrap).toHaveBeenCalledWith("main");
  });

  it("flags a minimized window's report, so its last rect is kept", async () => {
    appWindow.outerPosition.mockResolvedValue({ x: -32000, y: -32000 });
    appWindow.isMinimized.mockResolvedValue(true);

    renderLifecycle();

    await waitFor(() => expect(workspaceSetWindowBounds).toHaveBeenCalledWith(
      "window-1",
      expect.objectContaining({ x: -32000, y: -32000 }),
      true,
    ));
  });

  it("reports a burst of moves and resizes once, after the delay", async () => {
    vi.useFakeTimers();
    renderLifecycle();
    await vi.waitFor(() => expect(listenWorkspaceUpdated).toHaveBeenCalled());
    workspaceSetWindowBounds.mockClear();

    emitMoved();
    emitResized();
    emitMoved();
    await vi.advanceTimersByTimeAsync(BOUNDS_SYNC_DELAY_MS - 1);
    expect(workspaceSetWindowBounds).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(workspaceSetWindowBounds).toHaveBeenCalledTimes(1));
  });

  it("drops a pending report on unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = renderLifecycle();
    await vi.waitFor(() => expect(listenWorkspaceUpdated).toHaveBeenCalled());
    workspaceSetWindowBounds.mockClear();

    emitMoved();
    unmount();

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(BOUNDS_SYNC_DELAY_MS);
    expect(workspaceSetWindowBounds).not.toHaveBeenCalled();
  });
});
