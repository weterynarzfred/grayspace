import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("jsonrepair", () => ({
  jsonrepair: vi.fn(() => {
    throw new Error("Unable to repair workspace config");
  }),
}));

import useWorkspaceTabTitles from "./useWorkspaceTabTitles";

describe("useWorkspaceTabTitles parse-failure fallback", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue("{ name: 'Should not be used', }");
  });

  it("falls back to workspace folder name when jsonrepair throws", async () => {
    const tabs = [
      {
        tabId: "tab-1",
        title: "Tab 1",
        workspaceRoot: "C:\\Users\\WorkspaceA",
        activePaneId: "pane-a",
        paneStates: {},
      },
    ];

    const { result } = renderHook(() => useWorkspaceTabTitles(tabs));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("workspace_read_folder_config", {
        workspaceRoot: "C:\\Users\\WorkspaceA",
      });
      expect(result.current["tab-1"]).toBe("ws: WorkspaceA");
    });
  });
});
