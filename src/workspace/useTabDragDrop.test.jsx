import { act, renderHook } from "@testing-library/react";
import {
  enqueueFilesystemOperation,
  resetFilesystemOperationQueue,
} from "../components/FilesystemPanel/operations/filesystemOperationQueue";
import { getTabDndId } from "./dragCoordinator";
import useTabDragDrop from "./useTabDragDrop";
import { workspaceDetachTabToNewWindow, workspaceMoveTab } from "./workspaceApi";

// The operation queue listens to transfer progress while it has operations.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: vi.fn(),
}));

vi.mock("./workspaceApi", () => ({
  workspaceCloseWindow: vi.fn(),
  workspaceDetachTabToNewWindow: vi.fn(),
  workspaceMoveTab: vi.fn(),
}));

const CURRENT_WINDOW = {
  windowId: "window-1",
  tabOrder: ["tab-busy", "tab-idle"],
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  minimized: false,
};
const OTHER_WINDOW = {
  windowId: "window-2",
  tabOrder: ["tab-other"],
  bounds: { x: 1000, y: 0, width: 800, height: 600 },
  minimized: false,
};
const SNAPSHOT = { windows: [CURRENT_WINDOW, OTHER_WINDOW], tabs: [] };
const ON_OTHER_WINDOW = { x: 1200, y: 100 };
const OUTSIDE_EVERY_WINDOW = { x: 400, y: 900 };
const REFUSAL = "Wait for this tab's file operations to finish, or cancel them, before moving it to another window.";

// Drags the tab from the tab strip to the screen point `pointer` and drops it there, onto the tab
// `overTabId` when one is given.
async function dragTab(result, tabId, pointer, overTabId = "") {
  const active = { id: getTabDndId(tabId) };
  act(() => {
    result.current.handleTabDragStart({ active, activatorEvent: { screenX: 100, screenY: 10 } });
  });
  result.current.handleTabDragMove({ delta: { x: pointer.x - 100, y: pointer.y - 10 } });
  await act(() => result.current.handleTabDrop({
    active,
    over: overTabId ? { id: getTabDndId(overTabId) } : null,
  }));
}

describe("useTabDragDrop", () => {
  let onError;

  beforeEach(() => {
    vi.clearAllMocks();
    onError = vi.fn();
    // Never finishes: the tab has a file operation running for the whole test.
    enqueueFilesystemOperation("tab-busy", {
      label: "Copying",
      paneKey: "tab-busy::left",
      run: () => new Promise(() => {}),
    });
  });

  afterEach(() => {
    resetFilesystemOperationQueue();
  });

  function renderTabDragDrop() {
    return renderHook(() => useTabDragDrop({ snapshot: SNAPSHOT, currentWindow: CURRENT_WINDOW, onError }));
  }

  it("refuses to move a tab with file operations to another window or out to a new one, and still reorders it", async () => {
    const { result } = renderTabDragDrop();

    await dragTab(result, "tab-busy", ON_OTHER_WINDOW);
    await dragTab(result, "tab-busy", OUTSIDE_EVERY_WINDOW);

    expect(workspaceMoveTab).not.toHaveBeenCalled();
    expect(workspaceDetachTabToNewWindow).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(REFUSAL);
    expect(result.current.activeDragTabId).toBe("");

    await dragTab(result, "tab-busy", { x: 300, y: 10 }, "tab-idle");

    expect(workspaceMoveTab).toHaveBeenCalledWith("window-1", "window-1", "tab-busy", 1);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("moves a tab without file operations to another window while another tab has some", async () => {
    const { result } = renderTabDragDrop();

    await dragTab(result, "tab-idle", ON_OTHER_WINDOW);

    expect(workspaceMoveTab).toHaveBeenCalledWith("window-1", "window-2", "tab-idle", null);
    expect(onError).not.toHaveBeenCalled();
  });
});
