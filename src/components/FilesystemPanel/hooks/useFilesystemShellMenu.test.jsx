import { renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import useFilesystemShellMenu, { resolveShellMenuTarget } from "./useFilesystemShellMenu";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const entryContext = {
  targetType: "file",
  targetPath: "C:\\photos\\a.jpg",
  pointerX: 40,
  pointerY: 60,
};

describe("resolveShellMenuTarget", () => {
  it("uses the folder background for the panel and the selection for entries", () => {
    expect(resolveShellMenuTarget({ targetType: "panel" }, [], "C:\\photos"))
      .toEqual({ kind: "background", folder: "C:\\photos" });
    expect(resolveShellMenuTarget(entryContext, ["C:\\photos\\a.jpg", "C:\\Photos\\b.jpg"], "C:\\photos"))
      .toEqual({ kind: "items", paths: ["C:\\photos\\a.jpg", "C:\\Photos\\b.jpg"] });
    expect(resolveShellMenuTarget({ targetType: "folder", targetPath: "C:\\" }, ["C:\\", "D:\\"], ""))
      .toEqual({ kind: "items", paths: ["C:\\", "D:\\"] });
  });

  it("falls back to the clicked item when the selection spans folders", () => {
    expect(resolveShellMenuTarget(entryContext, ["C:\\photos\\a.jpg", "C:\\photos\\2024\\b.jpg"], "C:\\photos"))
      .toEqual({ kind: "items", paths: ["C:\\photos\\a.jpg"] });
  });
});

describe("useFilesystemShellMenu", () => {
  function renderShellMenu() {
    const options = {
      currentPath: "C:\\photos",
      resolveSelectedPaths: () => ["C:\\photos\\a.jpg"],
      onOpen: vi.fn(),
      onRename: vi.fn(),
      pushNotification: vi.fn(),
    };
    const { result } = renderHook(() => useFilesystemShellMenu(options));
    return { showShellMenu: result.current, ...options };
  }

  beforeEach(() => {
    invoke.mockReset();
  });

  it("hands open and rename of the menu's items back to grayspace", async () => {
    const { showShellMenu, onOpen, onRename } = renderShellMenu();

    invoke.mockResolvedValueOnce("rename");
    await showShellMenu({ ...entryContext, extendedVerbs: true });
    expect(invoke).toHaveBeenCalledWith("filesystem_show_shell_menu", {
      target: { kind: "items", paths: ["C:\\photos\\a.jpg"] },
      x: 40,
      y: 60,
      extended: true,
    });
    expect(onRename).toHaveBeenCalledWith("C:\\photos\\a.jpg");

    invoke.mockResolvedValueOnce("open");
    await showShellMenu(entryContext);
    expect(onOpen).toHaveBeenCalledWith(["C:\\photos\\a.jpg"]);

    invoke.mockResolvedValueOnce(null);
    await showShellMenu(entryContext);
    invoke.mockResolvedValueOnce("open");
    await showShellMenu({ targetType: "panel", pointerX: 1, pointerY: 2 });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("reports a failed menu", async () => {
    const { showShellMenu, pushNotification } = renderShellMenu();
    invoke.mockRejectedValueOnce("Windows could not open 'C:\\photos\\a.jpg'");

    await showShellMenu(entryContext);

    expect(pushNotification).toHaveBeenCalledWith({
      title: "Windows menu failed",
      message: "Windows could not open 'C:\\photos\\a.jpg'",
      tone: "error",
    });
  });
});
