import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import useWorkspaceScripts, { parseWorkspaceScripts } from "./useWorkspaceScripts";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("parseWorkspaceScripts", () => {
  it("parses scripts from repaired folder config", () => {
    expect(parseWorkspaceScripts("{ scripts: { build: 'npm run build', test: 'npm test', }, }")).toEqual([
      { name: "build", command: "npm run build" },
      { name: "test", command: "npm test" },
    ]);
  });

  it("returns an empty list when scripts are missing or invalid", () => {
    expect(parseWorkspaceScripts("{}")).toEqual([]);
    expect(parseWorkspaceScripts("{\"scripts\":[]}")).toEqual([]);
    expect(parseWorkspaceScripts("{\"scripts\":{\"build\":\"\"}}")).toEqual([]);
  });
});

describe("useWorkspaceScripts", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("loads workspace scripts from folder.json", async () => {
    invoke.mockResolvedValue("{\"scripts\":{\"run\":\"node ./server.js\"}}");

    const { result } = renderHook(() => useWorkspaceScripts("C:\\Workspace"));

    await waitFor(() => {
      expect(result.current).toEqual([{ name: "run", command: "node ./server.js" }]);
    });

    expect(invoke).toHaveBeenCalledWith("workspace_read_folder_config", {
      workspaceRoot: "C:\\Workspace",
    });
  });

  it("does not load scripts when workspace root is missing", () => {
    const { result } = renderHook(() => useWorkspaceScripts(""));
    expect(result.current).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
