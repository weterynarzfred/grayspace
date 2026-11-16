import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { normalizeFilesystemPaneState } from "../filesystemPaneState";
import useFilesystemViewStyle from "./useFilesystemViewStyle";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

function renderViewStyle(filesystemState = {}) {
  return renderHook(() => useFilesystemViewStyle({
    initialFilesystemState: normalizeFilesystemPaneState({
      currentDrive: "C:\\",
      currentPath: "C:\\Photos",
      ...filesystemState,
    }),
    tabId: "tab-1",
    paneId: "pane-1",
  }));
}

function savedStyles() {
  return invoke.mock.calls
    .filter(([command]) => command === "workspace_folder_view_styles_set")
    .map(([, payload]) => payload);
}

describe("useFilesystemViewStyle", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(null);
  });

  it("saves every size from a Ctrl+Wheel burst that arrives before a re-render", () => {
    const { result } = renderViewStyle({ thumbnailSizePx: 22 });
    const wheelUp = { ctrlKey: true, deltaY: -1, preventDefault: vi.fn() };

    act(() => {
      result.current.handleCtrlWheel(wheelUp);
      result.current.handleCtrlWheel(wheelUp);
    });

    expect(result.current.viewStyle.thumbnailSizePx).toBe(48);
    expect(savedStyles().map(({ style }) => style.thumbnailSizePx)).toEqual([32, 48]);
    expect(savedStyles()[0].path).toBe("C:\\Photos");
  });

  it("ignores plain wheel events and does not save at the size limits", () => {
    const { result } = renderViewStyle({ thumbnailSizePx: 22 });

    act(() => {
      result.current.handleCtrlWheel({ ctrlKey: false, deltaY: -1, preventDefault: vi.fn() });
      result.current.handleCtrlWheel({ ctrlKey: true, deltaY: 1, preventDefault: vi.fn() });
    });

    expect(result.current.viewStyle.thumbnailSizePx).toBe(22);
    expect(savedStyles()).toEqual([]);
  });

  it("wraps around when cycling the thumbnail size from the header button", () => {
    const { result } = renderViewStyle({ thumbnailSizePx: 256 });

    act(() => result.current.stepThumbnailSize(1, { wrap: true }));

    expect(result.current.viewStyle.thumbnailSizePx).toBe(22);
  });

  it("reverses the order when sorting by the active key and picks a default direction for a new key", () => {
    const { result } = renderViewStyle();

    act(() => result.current.sortBy("name"));
    expect(result.current.viewStyle).toMatchObject({ sortKey: "name", sortDescending: true });

    act(() => result.current.sortBy("modified"));
    expect(result.current.viewStyle).toMatchObject({ sortKey: "modified", sortDescending: true });

    act(() => result.current.sortBy("type"));
    expect(result.current.viewStyle).toMatchObject({ sortKey: "type", sortDescending: false });

    act(() => result.current.toggleSortDirection());
    expect(result.current.viewStyle).toMatchObject({ sortKey: "type", sortDescending: true });
    expect(savedStyles().at(-1).style).toEqual({
      viewType: "folder-tree",
      thumbnailSizePx: 22,
      sortKey: "type",
      sortDescending: true,
    });
  });

  it("applies valid fields of a saved folder style and saves later changes for that folder", async () => {
    invoke.mockImplementation(async (command) => (
      command === "workspace_folder_view_styles_get"
        ? { viewType: "details", thumbnailSizePx: 999, sortKey: "size", sortDescending: true }
        : null
    ));
    const { result } = renderViewStyle({ thumbnailSizePx: 64 });

    act(() => result.current.loadViewStyleForPath("D:\\Music"));

    await waitFor(() => expect(result.current.viewStyle.viewType).toBe("details"));
    expect(result.current.viewStyle).toEqual({
      viewType: "details",
      thumbnailSizePx: 64,
      sortKey: "size",
      sortDescending: true,
    });

    act(() => result.current.updateViewStyle({ viewType: "grid" }));
    expect(savedStyles().at(-1).path).toBe("D:\\Music");
  });
});
