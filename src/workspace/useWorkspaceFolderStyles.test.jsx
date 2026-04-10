import { renderHook, waitFor } from "@testing-library/react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import useWorkspaceFolderStyles, {
  FOLDER_STYLES_ELEMENT_ID,
  parseStylesheetPathFromFolderConfig,
  rewriteStylesheetUrlsForWorkspace,
  resolveFolderConfigRoot,
} from "./useWorkspaceFolderStyles";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path) => `asset://localhost/${encodeURIComponent(path || "")}`),
}));

describe("useWorkspaceFolderStyles", () => {
  beforeEach(() => {
    invoke.mockReset();
    convertFileSrc.mockClear();
    document.getElementById(FOLDER_STYLES_ELEMENT_ID)?.remove();
  });

  afterEach(() => {
    document.getElementById(FOLDER_STYLES_ELEMENT_ID)?.remove();
  });

  it("extracts styles path from repaired folder config text", () => {
    expect(parseStylesheetPathFromFolderConfig("{ styles: 'user/styles.css', }"))
      .toBe("user/styles.css");
    expect(parseStylesheetPathFromFolderConfig("{\"name\":\"Workspace\"}"))
      .toBe("");
    expect(parseStylesheetPathFromFolderConfig("{"))
      .toBe("");
  });

  it("rewrites workspace-relative stylesheet urls to Tauri asset urls", () => {
    const rewritten = rewriteStylesheetUrlsForWorkspace(
      ".shell{background:url('.grayspace/bg image.png');mask:url(icons/mask.svg#m)}",
      "H:\\gstest",
    );

    expect(rewritten).toContain("asset://localhost/H%3A%5Cgstest%5C.grayspace%5Cbg%20image.png");
    expect(rewritten).toContain("asset://localhost/H%3A%5Cgstest%5Cicons%5Cmask.svg#m");
    expect(convertFileSrc).toHaveBeenCalledWith("H:\\gstest\\.grayspace\\bg image.png");
    expect(convertFileSrc).toHaveBeenCalledWith("H:\\gstest\\icons\\mask.svg");
  });

  it("keeps non-workspace url schemes untouched", () => {
    const cssText = [
      "a{background:url('https://example.com/bg.png')}",
      "b{background:url('data:image/png;base64,abc')}",
      "c{background:url('asset://localhost/foo.png')}",
      "d{background:url('#frag')}",
    ].join("");
    const rewritten = rewriteStylesheetUrlsForWorkspace(cssText, "H:\\gstest");
    expect(rewritten).toBe(cssText);
    expect(convertFileSrc).not.toHaveBeenCalled();
  });

  it("prefers tab workspace root and falls back to active filesystem path", () => {
    expect(resolveFolderConfigRoot(
      { workspaceRoot: "  C:\\WorkspaceRoot  " },
      { panelType: "Filesystem", filesystemState: { currentPath: "C:\\WorkspaceRoot\\src" } },
    )).toBe("C:\\WorkspaceRoot");
    expect(resolveFolderConfigRoot(
      { workspaceRoot: "" },
      { panelType: "Filesystem", filesystemState: { currentPath: "C:\\FolderOnly" } },
    )).toBe("C:\\FolderOnly");
    expect(resolveFolderConfigRoot(
      { workspaceRoot: "" },
      { panelType: "Preview", filesystemState: { currentPath: "C:\\FolderOnly" } },
    )).toBe("");
  });

  it("loads styles from folder config and removes style element on unmount", async () => {
    invoke.mockImplementation(async (command, payload) => {
      if (command === "workspace_read_folder_config") {
        expect(payload).toEqual({ workspaceRoot: "C:\\WorkspaceRoot" });
        return "{ styles: '.grayspace/user/styles.css', }";
      }
      if (command === "workspace_read_folder_stylesheet") {
        expect(payload).toEqual({
          workspaceRoot: "C:\\WorkspaceRoot",
          stylesheetPath: ".grayspace/user/styles.css",
        });
        return ".workspaceContent { border: 1px solid red; background: url('.grayspace/bg.png'); }";
      }
      throw new Error(`Unhandled command: ${command}`);
    });

    const { unmount } = renderHook(() => useWorkspaceFolderStyles({
      activeTab: { workspaceRoot: "C:\\WorkspaceRoot" },
      activePaneState: { panelType: "Filesystem", filesystemState: { currentPath: "C:\\WorkspaceRoot" } },
    }));

    await waitFor(() => {
      const styleElement = document.getElementById(FOLDER_STYLES_ELEMENT_ID);
      expect(styleElement).toBeTruthy();
      expect(styleElement?.textContent).toContain("border: 1px solid red");
      expect(styleElement?.textContent).toContain("asset://localhost/C%3A%5CWorkspaceRoot%5C.grayspace%5Cbg.png");
    });

    unmount();
    expect(document.getElementById(FOLDER_STYLES_ELEMENT_ID)).toBeNull();
  });

  it("uses active filesystem path when workspace root is missing", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "workspace_read_folder_config") return "{ styles: 'user/styles.css' }";
      if (command === "workspace_read_folder_stylesheet") return "body { color: teal; }";
      throw new Error(`Unhandled command: ${command}`);
    });

    renderHook(() => useWorkspaceFolderStyles({
      activeTab: { workspaceRoot: "" },
      activePaneState: {
        panelType: "Filesystem",
        filesystemState: { currentPath: "D:\\FolderOnly" },
      },
    }));

    await waitFor(() => {
      const configLoadCall = invoke.mock.calls.find(
        ([command]) => command === "workspace_read_folder_config",
      );
      expect(configLoadCall).toBeTruthy();
      expect(configLoadCall?.[1]).toEqual({ workspaceRoot: "D:\\FolderOnly" });
    });
  });

  it("ignores stale requests when root changes quickly", async () => {
    let resolveWorkspaceAConfig = () => { };
    const workspaceAConfigPromise = new Promise((resolve) => {
      resolveWorkspaceAConfig = resolve;
    });

    invoke.mockImplementation(async (command, payload) => {
      const root = String(payload?.workspaceRoot ?? "");
      if (command === "workspace_read_folder_config" && root === "C:\\WorkspaceA") {
        return workspaceAConfigPromise;
      }
      if (command === "workspace_read_folder_config" && root === "C:\\WorkspaceB") {
        return "{\"styles\":\"user/second.css\"}";
      }
      if (command === "workspace_read_folder_stylesheet" && root === "C:\\WorkspaceB") {
        return ".workspaceContent { color: green; }";
      }
      if (command === "workspace_read_folder_stylesheet" && root === "C:\\WorkspaceA") {
        return ".workspaceContent { color: red; }";
      }
      throw new Error(`Unhandled command: ${command}`);
    });

    const { rerender } = renderHook(
      ({ activeTab, activePaneState }) => useWorkspaceFolderStyles({ activeTab, activePaneState }),
      {
        initialProps: {
          activeTab: { workspaceRoot: "C:\\WorkspaceA" },
          activePaneState: { panelType: "Filesystem", filesystemState: { currentPath: "C:\\WorkspaceA" } },
        },
      },
    );

    rerender({
      activeTab: { workspaceRoot: "C:\\WorkspaceB" },
      activePaneState: { panelType: "Filesystem", filesystemState: { currentPath: "C:\\WorkspaceB" } },
    });

    resolveWorkspaceAConfig("{\"styles\":\"user/first.css\"}");

    await waitFor(() => {
      const styleElement = document.getElementById(FOLDER_STYLES_ELEMENT_ID);
      expect(styleElement).toBeTruthy();
      expect(styleElement?.textContent).toContain("color: green");
      expect(styleElement?.textContent).not.toContain("color: red");
    });

    const staleStylesheetCalls = invoke.mock.calls.filter(
      ([command, payload]) => (
        command === "workspace_read_folder_stylesheet"
        && String(payload?.workspaceRoot ?? "") === "C:\\WorkspaceA"
      ),
    );
    expect(staleStylesheetCalls).toHaveLength(0);
  });
});
