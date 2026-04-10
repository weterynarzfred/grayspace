import path from "node:path";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { cursorPosition } from "@tauri-apps/api/window";
import { useDroppable } from "@dnd-kit/core";
import FilesystemPanel from "./FilesystemPanel";
import { clearFilesystemClipboardState } from "./filesystemClipboardStore";
import PanelsDndLayer from "../PanelsDndLayer";
import { APP_COMMAND_EVENT } from "../../commands/commandEvents";
import { flushPromises, runInAct, runInAsyncAct } from "../../test/utils/actCallbacks";
import { advanceTimersBy } from "../../test/utils/timers";

const { openConfirmMock } = vi.hoisted(() => ({
  openConfirmMock: vi.fn(),
}));

const dndCallbacks = {
  onDragStart: undefined,
  onDragOver: undefined,
  onDragEnd: undefined,
  onDragCancel: undefined,
};
let externalDropCallback;
let filesystemWatchCallback;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../notifications/notificationCenter", () => ({
  useNotificationCenter: () => ({
    openConfirm: openConfirmMock,
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName, handler) => {
    if (eventName === "filesystem-watch-event") filesystemWatchCallback = runInAsyncAct(handler);
    return () => {
      filesystemWatchCallback = undefined;
    };
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  cursorPosition: vi.fn(async () => ({ x: 100, y: 100 })),
  getCurrentWindow: () => ({
    onDragDropEvent: vi.fn(async (handler) => {
      externalDropCallback = runInAsyncAct(handler);
      return () => {
        externalDropCallback = undefined;
      };
    }),
    innerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
    innerSize: vi.fn(async () => ({ width: 500, height: 500 })),
  }),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragStart, onDragOver, onDragEnd, onDragCancel }) => {
    dndCallbacks.onDragStart = runInAct(onDragStart);
    dndCallbacks.onDragOver = runInAct(onDragOver);
    dndCallbacks.onDragEnd = runInAsyncAct(onDragEnd);
    dndCallbacks.onDragCancel = runInAct(onDragCancel);
    return <>{children}</>;
  },
  DragOverlay: ({ children }) => <>{children}</>,
  PointerSensor: class { },
  pointerWithin: vi.fn(() => []),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn((...sensors) => sensors),
  useDraggable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  })),
  useDroppable: vi.fn(() => ({
    isOver: false,
    setNodeRef: vi.fn(),
  })),
}));

function renderFilesystemPanel(props = {}) {
  return render(
    <PanelsDndLayer>
      <FilesystemPanel {...props} />
    </PanelsDndLayer>,
  );
}

function renderFilesystemPanels(primaryProps = {}, secondaryProps = {}) {
  return render(
    <PanelsDndLayer>
      <FilesystemPanel
        tabId="tab-cross"
        paneId="pane-primary"
        {...primaryProps}
      />
      <FilesystemPanel
        tabId="tab-cross"
        paneId="pane-secondary"
        {...secondaryProps}
      />
    </PanelsDndLayer>,
  );
}

describe("FilesystemPanel", () => {
  beforeEach(() => {
    clearFilesystemClipboardState();
    externalDropCallback = undefined;
    filesystemWatchCallback = undefined;
    dndCallbacks.onDragStart = undefined;
    dndCallbacks.onDragOver = undefined;
    dndCallbacks.onDragEnd = undefined;
    dndCallbacks.onDragCancel = undefined;
    cursorPosition.mockResolvedValue({ x: 100, y: 100 });
    useDroppable.mockImplementation(() => ({
      isOver: false,
      setNodeRef: vi.fn(),
    }));
    openConfirmMock.mockReset();
    openConfirmMock.mockResolvedValue(true);

    const directoryState = {
      "C:\\": [
        { name: "Users", path: "C:\\Users", is_dir: true },
        { name: "Temp", path: "C:\\Temp", is_dir: true },
        { name: "notes.txt", path: "C:\\notes.txt", is_dir: false },
        { name: "draft.md", path: "C:\\draft.md", is_dir: false },
        { name: ".grayspace", path: "C:\\.grayspace", is_dir: true },
      ],
      "C:\\Users": [
        { name: "Projects", path: "C:\\Users\\Projects", is_dir: true },
        { name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false },
        { name: ".grayspace", path: "C:\\Users\\.grayspace", is_dir: true },
      ],
      "C:\\Users\\Projects": [],
      "C:\\Users\\.grayspace": [],
      "C:\\Temp": [],
    };

    invoke.mockReset();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives")
        return [{ name: "C:", path: "C:\\" }];

      if (command === "list_directory_page") {
        const entries = directoryState[payload?.path];
        if (!entries)
          throw new Error(`Unhandled list_directory_page path: ${payload?.path}`);

        const offset = payload?.offset ?? 0;
        const limit = payload?.limit ?? entries.length;
        const pageEntries = entries.slice(offset, offset + limit).map((entry) => ({ ...entry }));
        return {
          entries: pageEntries,
          hasMore: offset + pageEntries.length < entries.length,
          totalCount: entries.length,
        };
      }

      if (command === "list_directory") {
        const entries = directoryState[payload?.path];
        if (!entries)
          throw new Error(`Unhandled list_directory path: ${payload?.path}`);
        return entries.map((entry) => ({ ...entry }));
      }

      if (command === "filesystem_resolve_workspace_folders") {
        const paths = payload?.paths ?? [];
        const result = {};
        paths.forEach((workspacePath) => {
          const children = directoryState[workspacePath] ?? [];
          result[workspacePath] = children.some(
            entry => entry.is_dir && entry.name === ".grayspace",
          );
        });
        return result;
      }

      if (command === "parent_path") {
        if (payload?.path === "C:\\")
          return null;
        return path.win32.dirname(payload?.path ?? "");
      }

      if (command === "open_path")
        return null;

      if (command === "workspace_open_workspace_folder_from_tab")
        return null;

      if (command === "workspace_open_folder_from_tab")
        return null;

      if (command === "move_path") {
        const source = payload?.source;
        const destinationDir = payload?.destinationDir;
        const sourceParent = path.win32.dirname(source ?? "");
        const sourceName = path.win32.basename(source ?? "");
        const sourceEntries = directoryState[sourceParent] ?? [];
        const sourceEntry = sourceEntries.find((entry) => entry.path === source);

        if (!sourceEntry)
          throw new Error(`Missing source entry for ${source}`);

        directoryState[sourceParent] = sourceEntries.filter((entry) => entry.path !== source);
        const destinationEntries = directoryState[destinationDir] ?? [];
        directoryState[destinationDir] = [
          ...destinationEntries,
          {
            ...sourceEntry,
            path: path.win32.join(destinationDir, sourceName),
          },
        ];
        return null;
      }

      if (command === "rename_path") {
        const sourcePath = payload?.path ?? "";
        const requestedName = String(payload?.newName ?? "").trim();
        const allowAdjustment = payload?.allowAdjustment !== false;
        const parentPath = path.win32.dirname(sourcePath);
        const sourceEntries = directoryState[parentPath] ?? [];
        const sourceEntry = sourceEntries.find((entry) => entry.path === sourcePath);

        if (!sourceEntry)
          throw new Error(`Missing source entry for ${sourcePath}`);

        let resolvedName = requestedName;
        const extensionIndex = requestedName.lastIndexOf(".");
        const baseName = extensionIndex > 0 ? requestedName.slice(0, extensionIndex) : requestedName;
        const extension = extensionIndex > 0 ? requestedName.slice(extensionIndex) : "";
        let suffixCounter = 1;

        const hasNameConflict = (candidateName) => sourceEntries.some((entry) => (
          entry.path !== sourcePath && entry.name === candidateName
        ));
        while (hasNameConflict(resolvedName)) {
          if (!allowAdjustment) {
            throw new Error(`An item named '${requestedName}' already exists in this folder.`);
          }
          resolvedName = `${baseName}.${String(suffixCounter).padStart(3, "0")}${extension}`;
          suffixCounter += 1;
        }

        const renamedPath = path.win32.join(parentPath, resolvedName);
        const remapPath = (candidatePath) => {
          if (candidatePath === sourcePath) return renamedPath;
          if (sourceEntry.is_dir && candidatePath.startsWith(`${sourcePath}\\`))
            return `${renamedPath}${candidatePath.slice(sourcePath.length)}`;
          return candidatePath;
        };
        const nextDirectoryState = {};
        Object.entries(directoryState).forEach(([directoryPath, directoryEntries]) => {
          const remappedDirectoryPath = remapPath(directoryPath);
          nextDirectoryState[remappedDirectoryPath] = directoryEntries.map((entry) => {
            const remappedEntryPath = remapPath(entry.path);
            if (remappedEntryPath === entry.path) return entry;
            return {
              ...entry,
              name: entry.path === sourcePath ? resolvedName : entry.name,
              path: remappedEntryPath,
            };
          });
        });
        Object.keys(directoryState).forEach((key) => {
          delete directoryState[key];
        });
        Object.assign(directoryState, nextDirectoryState);

        return {
          path: renamedPath,
          name: resolvedName,
          requestedName,
          adjusted: resolvedName !== requestedName,
        };
      }

      if (command === "create_text_file" || command === "create_folder") {
        const parentDir = payload?.parentDir ?? "";
        const requestedName = String(payload?.name ?? "").trim();
        const parentEntries = directoryState[parentDir];
        if (!parentEntries) {
          throw new Error(`Unhandled create parent path: ${parentDir}`);
        }

        let resolvedName = requestedName;
        while (parentEntries.some(entry => entry.name === resolvedName)) {
          const extensionIndex = resolvedName.lastIndexOf(".");
          const baseName = extensionIndex > 0 ? resolvedName.slice(0, extensionIndex) : resolvedName;
          const extension = extensionIndex > 0 ? resolvedName.slice(extensionIndex) : "";
          const suffixMatch = baseName.match(/^(.*)\.(\d{3,})$/);
          if (suffixMatch) {
            const [, nameBase = "", counterValue = "0"] = suffixMatch;
            const width = counterValue.length;
            const nextCounter = String(Number(counterValue) + 1).padStart(width, "0");
            resolvedName = `${nameBase}.${nextCounter}${extension}`;
          } else {
            resolvedName = `${baseName}.001${extension}`;
          }
        }

        const createdPath = path.win32.join(parentDir, resolvedName);
        const isFolder = command === "create_folder";
        parentEntries.push({
          name: resolvedName,
          path: createdPath,
          is_dir: isFolder,
        });
        if (isFolder) directoryState[createdPath] = [];

        return {
          path: createdPath,
          name: resolvedName,
          requestedName,
          adjusted: resolvedName !== requestedName,
        };
      }

      if (command === "import_paths") {
        const destinationDir = payload?.destinationDir;
        const importPaths = payload?.paths ?? [];
        const destinationEntries = directoryState[destinationDir];
        if (!destinationEntries)
          throw new Error(`Unhandled import destination path: ${destinationDir}`);

        importPaths.forEach((sourcePath) => {
          const sourceName = path.win32.basename(sourcePath);
          destinationEntries.push({
            name: sourceName,
            path: path.win32.join(destinationDir, sourceName),
            is_dir: false,
          });
        });
        return null;
      }

      if (command === "delete_paths") {
        const deletePaths = payload?.paths ?? [];
        deletePaths.forEach((deletePath) => {
          const parentPath = path.win32.dirname(deletePath);
          const parentEntries = directoryState[parentPath] ?? [];
          const entryToDelete = parentEntries.find((entry) => entry.path === deletePath);

          directoryState[parentPath] = parentEntries.filter((entry) => entry.path !== deletePath);
          if (entryToDelete?.is_dir) {
            Object.keys(directoryState).forEach((directoryKey) => {
              if (directoryKey === deletePath || directoryKey.startsWith(`${deletePath}\\`))
                delete directoryState[directoryKey];
            });
          }
        });
        return null;
      }

      if (command === "start_external_drag")
        return null;

      if (command === "thumbnail_resolve_batch") {
        const items = payload?.request?.items ?? [];
        return {
          results: items.map((item, index) => ({
            sourcePath: item?.sourcePath ?? "",
            bucketPx: 64,
            key: `thumb-${index}`,
            status: "pending",
            thumbnailPath: null,
            mime: null,
            error: null,
          })),
        };
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
        return null;

      throw new Error(`Unhandled invoke: ${command}`);
    });
  });

  it("loads and shows available drives", async () => {
    renderFilesystemPanel();

    expect(screen.getByText("Loading drives...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("C:")).toBeInTheDocument();
    });
  });

  it("navigates into a selected drive and lists entries", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    expect(await screen.findByText("Users")).toBeInTheDocument();
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText("..")).toBeInTheDocument();
  });

  it("marks .grayspace folders as config entries", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const configButton = await screen.findByRole("button", { name: /\.grayspace/i });
    expect(within(configButton).getByText("config")).toBeInTheDocument();
  });

  it("marks folders with direct .grayspace children using config style", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    await waitFor(() => {
      expect(usersButton.className).toMatch(/configEntry/);
    });
    expect(within(usersButton).queryByText("config")).not.toBeInTheDocument();
    expect(within(usersButton).getByText("Folder")).toBeInTheDocument();
  });

  it("marks workspace folders in breadcrumbs", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.doubleClick(usersButton);

    const workspaceCrumb = await screen.findByRole("button", { name: "Users" });
    expect(workspaceCrumb.className).toMatch(/workspaceCrumb/);
  });

  it("uses breadcrumbs to jump back to a parent path", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.doubleClick(usersButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Users/i })).toBeInTheDocument();
    });

    const rootCrumb = screen.getByRole("button", { name: "Drives" });
    fireEvent.click(rootCrumb);

    expect(await screen.findByText("Select a drive")).toBeInTheDocument();
    expect(screen.getByText("C:")).toBeInTheDocument();
  });

  it("submits breadcrumb path input through tab folder replacement callback", async () => {
    const handleOpenFolderInCurrentTab = vi.fn().mockResolvedValue(undefined);

    renderFilesystemPanel({
      tabId: "tab-breadcrumb-input",
      onOpenFolderInCurrentTab: handleOpenFolderInCurrentTab,
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const breadcrumbsNav = await screen.findByRole("navigation", { name: "Current path" });
    fireEvent.click(breadcrumbsNav);

    const pathInput = await screen.findByRole("textbox", { name: "Current folder path" });
    fireEvent.change(pathInput, { target: { value: "C:\\Users" } });
    fireEvent.submit(pathInput.closest("form"));

    await waitFor(() => {
      expect(handleOpenFolderInCurrentTab).toHaveBeenCalledWith("tab-breadcrumb-input", "C:\\Users");
    });
  });

  it("normalizes lowercase drive letter when submitting breadcrumb path input", async () => {
    const handleOpenFolderInCurrentTab = vi.fn().mockResolvedValue(undefined);

    renderFilesystemPanel({
      tabId: "tab-breadcrumb-normalize-drive",
      onOpenFolderInCurrentTab: handleOpenFolderInCurrentTab,
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const breadcrumbsNav = await screen.findByRole("navigation", { name: "Current path" });
    fireEvent.click(breadcrumbsNav);

    const pathInput = await screen.findByRole("textbox", { name: "Current folder path" });
    fireEvent.change(pathInput, { target: { value: "c:\\users" } });
    fireEvent.submit(pathInput.closest("form"));

    await waitFor(() => {
      expect(handleOpenFolderInCurrentTab).toHaveBeenCalledWith(
        "tab-breadcrumb-normalize-drive",
        "C:\\users",
      );
    });
  });

  it("falls back to the first breadcrumb suggestion when typed path open fails", async () => {
    const handleOpenFolderInCurrentTab = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    renderFilesystemPanel({
      tabId: "tab-breadcrumb-fallback",
      onOpenFolderInCurrentTab: handleOpenFolderInCurrentTab,
      recentFoldersEntries: [
        { path: "D:\\program-notes", openedAtMs: 1710892800000, isWorkspace: false },
        { path: "C:\\Users", openedAtMs: 1710806400000, isWorkspace: false },
      ],
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const breadcrumbsNav = await screen.findByRole("navigation", { name: "Current path" });
    fireEvent.click(breadcrumbsNav);

    const pathInput = await screen.findByRole("textbox", { name: "Current folder path" });
    fireEvent.change(pathInput, { target: { value: "C:\\Use" } });
    fireEvent.submit(pathInput.closest("form"));

    await waitFor(() => {
      expect(handleOpenFolderInCurrentTab).toHaveBeenNthCalledWith(1, "tab-breadcrumb-fallback", "C:\\Use", {
        suppressNotFoundNotification: true,
      });
    });
    await waitFor(() => {
      expect(handleOpenFolderInCurrentTab).toHaveBeenNthCalledWith(2, "tab-breadcrumb-fallback", "C:\\Users", {
        suppressNotFoundNotification: false,
      });
    });
  });

  it("normalizes lowercase drive letter for both typed and fallback breadcrumb paths", async () => {
    const handleOpenFolderInCurrentTab = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    renderFilesystemPanel({
      tabId: "tab-breadcrumb-fallback-normalize-drive",
      onOpenFolderInCurrentTab: handleOpenFolderInCurrentTab,
      recentFoldersEntries: [
        { path: "c:\\users", openedAtMs: 1710806400000, isWorkspace: false },
      ],
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const breadcrumbsNav = await screen.findByRole("navigation", { name: "Current path" });
    fireEvent.click(breadcrumbsNav);

    const pathInput = await screen.findByRole("textbox", { name: "Current folder path" });
    fireEvent.change(pathInput, { target: { value: "c:\\use" } });
    fireEvent.submit(pathInput.closest("form"));

    await waitFor(() => {
      expect(handleOpenFolderInCurrentTab).toHaveBeenNthCalledWith(
        1,
        "tab-breadcrumb-fallback-normalize-drive",
        "C:\\use",
        { suppressNotFoundNotification: true },
      );
    });
    await waitFor(() => {
      expect(handleOpenFolderInCurrentTab).toHaveBeenNthCalledWith(
        2,
        "tab-breadcrumb-fallback-normalize-drive",
        "C:\\users",
        { suppressNotFoundNotification: false },
      );
    });
  });

  it("single click selects but does not open a drive", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.click(driveButton);

    expect(driveButton).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Select a drive")).toBeInTheDocument();
  });

  it("single click selects folders and files", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const folderButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.click(folderButton);
    expect(folderButton).toHaveAttribute("aria-selected", "true");

    const fileButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(fileButton);
    expect(fileButton).toHaveAttribute("aria-selected", "true");
    expect(folderButton).toHaveAttribute("aria-selected", "false");
  });

  it("expands a folder inline without changing root, then double click makes it root", async () => {
    const onCurrentPathChange = vi.fn();
    renderFilesystemPanel({ onCurrentPathChange });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const usersExpander = usersButton.querySelector("[data-entry-expander]");
    expect(usersExpander).toBeTruthy();
    fireEvent.click(usersExpander);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Projects/i })).toBeInTheDocument();
    });
    expect(onCurrentPathChange).toHaveBeenLastCalledWith("C:\\");

    fireEvent.doubleClick(usersExpander);

    await waitFor(() => {
      expect(onCurrentPathChange).toHaveBeenLastCalledWith("C:\\");
      expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
    });

    fireEvent.doubleClick(usersButton);

    await waitFor(() => {
      expect(onCurrentPathChange).toHaveBeenLastCalledWith("C:\\Users");
      expect(screen.queryByRole("button", { name: /notes\.txt/i })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
    });
  });

  it("refreshes expanded folder rows when that folder watcher emits a change", async () => {
    const directoryState = {
      "C:\\": [
        { name: "Users", path: "C:\\Users", is_dir: true },
      ],
      "C:\\Users": [
        { name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false },
      ],
    };

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives") return [{ name: "C:", path: "C:\\" }];
      if (command === "list_directory_page") {
        const entries = (directoryState[payload?.path] ?? []).map(entry => ({ ...entry }));
        const offset = payload?.offset ?? 0;
        const limit = payload?.limit ?? entries.length;
        const pageEntries = entries.slice(offset, offset + limit);
        return {
          entries: pageEntries,
          hasMore: offset + pageEntries.length < entries.length,
          totalCount: entries.length,
        };
      }
      if (command === "list_directory") return (directoryState[payload?.path] ?? []).map(entry => ({ ...entry }));
      if (command === "filesystem_resolve_workspace_folders") {
        const paths = payload?.paths ?? [];
        const result = {};
        paths.forEach((workspacePath) => {
          const children = directoryState[workspacePath] ?? [];
          result[workspacePath] = children.some(
            entry => entry.is_dir && entry.name === ".grayspace",
          );
        });
        return result;
      }
      if (command === "parent_path") {
        if (payload?.path === "C:\\") return null;
        return path.win32.dirname(payload?.path ?? "");
      }
      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") return null;
      if (command === "thumbnail_resolve_batch") return { results: [] };
      throw new Error(`Unhandled invoke: ${command}`);
    });

    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const usersExpander = usersButton.querySelector("[data-entry-expander]");
    expect(usersExpander).toBeTruthy();
    fireEvent.click(usersExpander);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
    });

    directoryState["C:\\Users"].push({
      name: "later.txt",
      path: "C:\\Users\\later.txt",
      is_dir: false,
    });

    const usersWatchStartCall = invoke.mock.calls.find(([command, args]) => (
      command === "filesystem_watch_start" && args?.path === "C:\\Users"
    ));
    const usersWatchId = usersWatchStartCall?.[1]?.watchId;
    expect(typeof usersWatchId).toBe("string");

    vi.useFakeTimers();
    try {
      await filesystemWatchCallback?.({
        payload: {
          watchId: usersWatchId,
          changedPath: "C:\\Users\\later.txt",
        },
      });
      await advanceTimersBy(160);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /later\.txt/i })).toBeInTheDocument();
    });
  });

  it("reports tab-level selection only for explicit entry clicks", async () => {
    const onTabSelectedFilesChange = vi.fn();
    renderFilesystemPanel({
      tabId: "tab-1",
      paneId: "left",
      onTabSelectedFilesChange,
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const fileButton = await screen.findByRole("button", { name: /notes\.txt/i });
    expect(onTabSelectedFilesChange).not.toHaveBeenCalled();

    fireEvent.click(fileButton);
    expect(onTabSelectedFilesChange).toHaveBeenCalledWith({
      selectedPaths: ["C:\\notes.txt"],
      selectedEntryKinds: {
        "C:\\notes.txt": "file",
      },
    });

    fireEvent.click(fileButton, { ctrlKey: true });
    expect(onTabSelectedFilesChange).toHaveBeenLastCalledWith({
      selectedPaths: [],
      selectedEntryKinds: {},
    });
  });

  it("supports ctrl-click toggling for multi-selection", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const folderButton = await screen.findByRole("button", { name: /Users/i });
    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(folderButton);
    fireEvent.click(notesButton, { ctrlKey: true });

    expect(folderButton).toHaveAttribute("aria-selected", "true");
    expect(notesButton).toHaveAttribute("aria-selected", "true");

    fireEvent.click(folderButton, { ctrlKey: true });

    expect(folderButton).toHaveAttribute("aria-selected", "false");
    expect(notesButton).toHaveAttribute("aria-selected", "true");
  });

  it("supports shift-click range selection", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const folderButton = await screen.findByRole("button", { name: /Users/i });
    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    const draftButton = await screen.findByRole("button", { name: /draft\.md/i });

    fireEvent.click(folderButton);
    fireEvent.click(draftButton, { shiftKey: true });

    expect(folderButton).toHaveAttribute("aria-selected", "true");
    expect(notesButton).toHaveAttribute("aria-selected", "true");
    expect(draftButton).toHaveAttribute("aria-selected", "true");
  });

  it("cycles thumbnail sizes and requests matching thumbnail size hints", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const sizeButton = screen.getByRole("button", {
      name: /Toggle icon and thumbnail size/i,
    });

    function getLatestThumbnailSizeHint() {
      const latestCall = [...invoke.mock.calls]
        .reverse()
        .find(([command]) => command === "thumbnail_resolve_batch");
      return latestCall?.[1]?.request?.items?.[0]?.sizeHintPx;
    }

    await waitFor(() => {
      expect(getLatestThumbnailSizeHint()).toBe(32);
    });

    fireEvent.click(sizeButton);
    expect(sizeButton).toHaveTextContent("64px");
    await waitFor(() => {
      expect(getLatestThumbnailSizeHint()).toBe(64);
    });

    fireEvent.click(sizeButton);
    expect(sizeButton).toHaveTextContent("128px");
    await waitFor(() => {
      expect(getLatestThumbnailSizeHint()).toBe(128);
    });

    fireEvent.click(sizeButton);
    expect(sizeButton).toHaveTextContent("256px");
    await waitFor(() => {
      expect(getLatestThumbnailSizeHint()).toBe(256);
    });

    fireEvent.click(sizeButton);
    expect(sizeButton).toHaveTextContent("32px");
    await waitFor(() => {
      expect(getLatestThumbnailSizeHint()).toBe(32);
    });
  });

  it("persists thumbnail size in filesystem pane state", async () => {
    const onFilesystemStateChange = vi.fn();
    renderFilesystemPanel({
      tabId: "tab-1",
      paneId: "left",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\",
        scrollTop: 0,
      },
      onFilesystemStateChange,
    });

    await screen.findByRole("button", { name: /Users/i });
    const sizeButton = screen.getByRole("button", {
      name: /Toggle icon and thumbnail size/i,
    });
    fireEvent.click(sizeButton);

    await waitFor(() => {
      const latestState = onFilesystemStateChange.mock.calls.at(-1)?.[0];
      expect(latestState?.thumbnailSizePx).toBe(64);
    });
  });

  it("hydrates thumbnail size from persisted filesystem state", async () => {
    renderFilesystemPanel({
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\",
        scrollTop: 0,
        thumbnailSizePx: 256,
      },
    });

    await screen.findByRole("button", { name: /Users/i });
    const sizeButton = screen.getByRole("button", {
      name: /Toggle icon and thumbnail size/i,
    });
    expect(sizeButton).toHaveTextContent("256px");

    await waitFor(() => {
      const latestThumbnailCall = [...invoke.mock.calls]
        .reverse()
        .find(([command]) => command === "thumbnail_resolve_batch");
      expect(latestThumbnailCall?.[1]?.request?.items?.[0]?.sizeHintPx).toBe(256);
    });
  });

  it("opens a file on double click", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const fileButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.doubleClick(fileButton);

    expect(invoke).toHaveBeenCalledWith("open_path", { path: "C:\\notes.txt" });
  });

  it("opens workspace folders in a new tab when tabId is present", async () => {
    renderFilesystemPanel({ tabId: "tab-1" });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const workspaceFolderButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.doubleClick(workspaceFolderButton);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("workspace_open_workspace_folder_from_tab", {
        payload: {
          tabId: "tab-1",
          workspaceRoot: "C:\\Users",
        },
      });
    });
    expect(screen.queryByRole("button", { name: /todo\.txt/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
  });

  it("opens non-workspace folders in a new tab on middle click", async () => {
    renderFilesystemPanel({ tabId: "tab-1" });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const tempFolderButton = await screen.findByRole("button", { name: /Temp/i });
    fireEvent.mouseDown(tempFolderButton, { button: 1 });
    fireEvent.mouseUp(tempFolderButton, { button: 1 });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("workspace_open_folder_from_tab", {
        payload: {
          tabId: "tab-1",
          path: "C:\\Temp",
        },
      });
    });
    expect(screen.getByRole("button", { name: /Temp/i })).toBeInTheDocument();
  });

  it("opens non-workspace folders in a new tab on ctrl+double click", async () => {
    renderFilesystemPanel({ tabId: "tab-1" });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const tempFolderButton = await screen.findByRole("button", { name: /Temp/i });
    fireEvent.doubleClick(tempFolderButton, { ctrlKey: true });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("workspace_open_folder_from_tab", {
        payload: {
          tabId: "tab-1",
          path: "C:\\Temp",
        },
      });
    });
  });

  it("opens a folder in a new tab when it is inside a workspace and current tab is outside", async () => {
    renderFilesystemPanel({ tabId: "tab-1" });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const usersExpander = usersButton.querySelector("[data-entry-expander]");
    expect(usersExpander).toBeTruthy();
    fireEvent.click(usersExpander);

    const nestedFolderButton = await screen.findByRole("button", { name: /Projects/i });
    fireEvent.doubleClick(nestedFolderButton);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("workspace_open_folder_from_tab", {
        payload: {
          tabId: "tab-1",
          path: "C:\\Users\\Projects",
        },
      });
    });
  });

  it("opens folders in place when already inside the same workspace", async () => {
    renderFilesystemPanel({
      tabId: "tab-1",
      tabWorkspaceRoot: "C:\\Users",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\Users",
        selectedPaths: [],
      },
    });

    const nestedFolderButton = await screen.findByRole("button", { name: /Projects/i });
    fireEvent.doubleClick(nestedFolderButton);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /todo\.txt/i })).not.toBeInTheDocument();
    });
    expect(invoke).not.toHaveBeenCalledWith("workspace_open_folder_from_tab", {
      payload: {
        tabId: "tab-1",
        path: "C:\\Users\\Projects",
      },
    });
  });

  it("moves an entry when dropped onto a folder", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
    });

    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\notes.txt" } });
    await dndCallbacks.onDragEnd?.({
      active: { id: "entry:C:\\notes.txt" },
      over: { id: "entry:C:\\Users" },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("move_path", {
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /notes\.txt/i })).not.toBeInTheDocument();
    });
  });

  it("copies an entry when ctrl is held while dropping", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
      expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
    });

    dndCallbacks.onDragStart?.({
      active: { id: "entry:C:\\notes.txt" },
      activatorEvent: { ctrlKey: false },
    });
    await dndCallbacks.onDragEnd?.({
      active: { id: "entry:C:\\notes.txt" },
      over: { id: "entry:C:\\Users" },
      activatorEvent: { ctrlKey: true },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("import_paths", {
        paths: ["C:\\notes.txt"],
        destinationDir: "C:\\Users",
      });
    });

    expect(invoke).not.toHaveBeenCalledWith("move_path", {
      source: "C:\\notes.txt",
      destinationDir: "C:\\Users",
    });
    expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
  });

  it("shows move/copy drag intent while dragging internally", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragStart).toBe("function");
      expect(typeof dndCallbacks.onDragCancel).toBe("function");
    });

    dndCallbacks.onDragStart?.({
      active: { id: "entry:C:\\notes.txt" },
      activatorEvent: { ctrlKey: false },
    });

    expect(await screen.findByText("Move")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Control", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByText("Copy")).toBeInTheDocument();
    });

    fireEvent.keyUp(window, { key: "Control", ctrlKey: false });
    await waitFor(() => {
      expect(screen.getByText("Move")).toBeInTheDocument();
    });

    dndCallbacks.onDragCancel?.();
    await waitFor(() => {
      expect(screen.queryByText("Move")).not.toBeInTheDocument();
      expect(screen.queryByText("Copy")).not.toBeInTheDocument();
    });
  });

  it("moves an entry when dropped onto a file row inside an expanded folder", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const usersExpander = usersButton.querySelector("[data-entry-expander]");
    expect(usersExpander).toBeTruthy();
    fireEvent.click(usersExpander);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
    });

    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\notes.txt" } });
    await dndCallbacks.onDragEnd?.({
      active: { id: "entry:C:\\notes.txt" },
      over: { id: "entry:C:\\Users\\todo.txt" },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("move_path", {
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      });
    });
  });

  it("does not move an entry when dropped onto a file row in the same folder", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
    });

    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\notes.txt" } });
    await dndCallbacks.onDragEnd?.({
      active: { id: "entry:C:\\notes.txt" },
      over: { id: "entry:C:\\draft.md" },
    });

    expect(invoke).not.toHaveBeenCalledWith("move_path", {
      source: "C:\\notes.txt",
      destinationDir: "C:\\draft.md",
    });
  });

  it("moves an entry into another panel current folder when dropped on panel target", async () => {
    renderFilesystemPanels(
      {
        filesystemState: {
          currentDrive: "C:\\",
          currentPath: "C:\\",
          selectedPaths: [],
        },
      },
      {
        filesystemState: {
          currentDrive: "C:\\",
          currentPath: "C:\\Users",
          selectedPaths: [],
        },
      },
    );

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
      expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
    });

    dndCallbacks.onDragStart?.({
      active: {
        id: "entry:C:\\notes.txt",
        data: {
          current: {
            sourcePath: "C:\\notes.txt",
            sourcePaneId: "pane-primary",
          },
        },
      },
    });
    await dndCallbacks.onDragEnd?.({
      active: {
        id: "entry:C:\\notes.txt",
        data: {
          current: {
            sourcePath: "C:\\notes.txt",
            sourcePaneId: "pane-primary",
          },
        },
      },
      over: { id: "panel:C:\\Users" },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("move_path", {
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      });
    });
  });

  it("moves an expanded subfolder file to root when dropped on panel empty space", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const usersExpander = usersButton.querySelector("[data-entry-expander]");
    expect(usersExpander).toBeTruthy();
    fireEvent.click(usersExpander);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
    });

    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\Users\\todo.txt" } });
    await dndCallbacks.onDragEnd?.({
      active: { id: "entry:C:\\Users\\todo.txt" },
      over: { id: "panel:C:\\" },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("move_path", {
        source: "C:\\Users\\todo.txt",
        destinationDir: "C:\\",
      });
    });
  });

  it("highlights only the destination folder row while hovering a file inside it", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const usersExpander = usersButton.querySelector("[data-entry-expander]");
    expect(usersExpander).toBeTruthy();
    fireEvent.click(usersExpander);

    const todoButton = await screen.findByRole("button", { name: /todo\.txt/i });
    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\notes.txt" } });
    dndCallbacks.onDragOver?.({
      active: { id: "entry:C:\\notes.txt" },
      over: { id: "entry:C:\\Users\\todo.txt" },
    });

    await waitFor(() => {
      expect(usersButton.className).toMatch(/dropTarget/);
      expect(todoButton.className).not.toMatch(/dropTarget/);
    });
  });

  it("moves an entry when dropped onto a folder listed in another panel", async () => {
    renderFilesystemPanels(
      {
        filesystemState: {
          currentDrive: "C:\\",
          currentPath: "C:\\",
          selectedPaths: [],
        },
      },
      {
        filesystemState: {
          currentDrive: "C:\\",
          currentPath: "C:\\",
          selectedPaths: [],
        },
      },
    );

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
      expect(screen.getAllByRole("button", { name: /notes\.txt/i }).length).toBeGreaterThan(0);
    });

    dndCallbacks.onDragStart?.({
      active: {
        id: "entry:C:\\notes.txt",
        data: {
          current: {
            sourcePath: "C:\\notes.txt",
            sourcePaneId: "pane-primary",
          },
        },
      },
    });
    await dndCallbacks.onDragEnd?.({
      active: {
        id: "entry:C:\\notes.txt",
        data: {
          current: {
            sourcePath: "C:\\notes.txt",
            sourcePaneId: "pane-primary",
          },
        },
      },
      over: { id: "entry:C:\\Users" },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("move_path", {
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      });
    });
  });

  it("moves all selected entries when dragging one selected item", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    const draftButton = await screen.findByRole("button", { name: /draft\.md/i });
    fireEvent.click(notesButton);
    fireEvent.click(draftButton, { ctrlKey: true });

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
    });

    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\notes.txt" } });
    await dndCallbacks.onDragEnd?.({
      active: { id: "entry:C:\\notes.txt" },
      over: { id: "entry:C:\\Users" },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("move_path", {
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      });
      expect(invoke).toHaveBeenCalledWith("move_path", {
        source: "C:\\draft.md",
        destinationDir: "C:\\Users",
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /notes\.txt/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /draft\.md/i })).not.toBeInTheDocument();
    });
  });

  it("starts an external drag when the pointer leaves the app window", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
    });

    cursorPosition.mockResolvedValue({ x: 900, y: 900 });
    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\notes.txt" } });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_external_drag", {
        paths: ["C:\\notes.txt"],
        mode: "copy",
      });
    });
    cursorPosition.mockResolvedValue({ x: 100, y: 100 });

    await dndCallbacks.onDragEnd?.({
      active: { id: "entry:C:\\notes.txt" },
      over: { id: "entry:C:\\Users" },
    });

    expect(invoke).not.toHaveBeenCalledWith("move_path", {
      source: "C:\\notes.txt",
      destinationDir: "C:\\Users",
    });
    expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
  });

  it("starts an external drag in copy mode even when Shift is held", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragStart).toBe("function");
    });

    cursorPosition.mockResolvedValue({ x: 900, y: 900 });
    dndCallbacks.onDragStart?.({
      active: { id: "entry:C:\\notes.txt" },
      activatorEvent: { shiftKey: true, ctrlKey: false },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_external_drag", {
        paths: ["C:\\notes.txt"],
        mode: "copy",
      });
    });
  });

  it("moves internal files when an external drag returns and drops back into the panel", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragStart).toBe("function");
      expect(typeof externalDropCallback).toBe("function");
    });

    cursorPosition.mockResolvedValue({ x: 900, y: 900 });
    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\notes.txt" } });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_external_drag", {
        paths: ["C:\\notes.txt"],
        mode: "copy",
      });
    });

    cursorPosition.mockResolvedValue({ x: 100, y: 100 });
    const panel = screen.getByLabelText("Filesystem panel");
    panel.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => usersButton);

    try {
      await externalDropCallback?.({
        payload: {
          type: "drop",
          paths: ["C:\\notes.txt"],
          position: { x: 100, y: 100 },
        },
      });
    } finally {
      document.elementFromPoint = originalElementFromPoint;
    }

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("move_path", {
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      });
    });
    expect(invoke).not.toHaveBeenCalledWith("import_paths", {
      paths: ["C:\\notes.txt"],
      destinationDir: "C:\\Users",
    });
  });

  it("matches returned internal drags when drop paths use extended device prefixes", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragStart).toBe("function");
      expect(typeof externalDropCallback).toBe("function");
    });

    cursorPosition.mockResolvedValue({ x: 900, y: 900 });
    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\notes.txt" } });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_external_drag", {
        paths: ["C:\\notes.txt"],
        mode: "copy",
      });
    });

    cursorPosition.mockResolvedValue({ x: 100, y: 100 });
    const panel = screen.getByLabelText("Filesystem panel");
    panel.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => usersButton);

    try {
      await externalDropCallback?.({
        payload: {
          type: "drop",
          paths: ["\\\\?\\C:\\notes.txt"],
          position: { x: 100, y: 100 },
        },
      });
    } finally {
      document.elementFromPoint = originalElementFromPoint;
    }

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("move_path", {
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      });
    });
    expect(invoke).not.toHaveBeenCalledWith("import_paths", {
      paths: ["\\\\?\\C:\\notes.txt"],
      destinationDir: "C:\\Users",
    });
  });

  it("does not react to drag-over after external drag has started", async () => {
    let mockOverId = null;
    useDroppable.mockImplementation(({ id }) => ({
      isOver: Boolean(mockOverId) && id === mockOverId,
      setNodeRef: vi.fn(),
    }));

    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragOver).toBe("function");
    });

    cursorPosition.mockResolvedValue({ x: 900, y: 900 });
    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\notes.txt" } });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_external_drag", {
        paths: ["C:\\notes.txt"],
        mode: "copy",
      });
    });
    cursorPosition.mockResolvedValue({ x: 100, y: 100 });

    mockOverId = "panel:C:\\";
    dndCallbacks.onDragOver?.({
      active: { id: "entry:C:\\notes.txt" },
      over: { id: "panel:C:\\" },
    });

    const panel = document.querySelector('section[aria-label="Filesystem panel"]');
    expect(panel?.className).not.toMatch(/panelDropTarget/);
  });

  it("does not move an entry when dropped onto itself", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
    });

    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\Users" } });
    await dndCallbacks.onDragEnd?.({
      active: { id: "entry:C:\\Users" },
      over: { id: "entry:C:\\Users" },
    });

    expect(invoke).not.toHaveBeenCalledWith("move_path", expect.anything());
  });

  it("moves an entry when dropped onto the .. up target", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.doubleClick(usersButton);

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
      expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
    });

    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\Users\\todo.txt" } });
    await dndCallbacks.onDragEnd?.({
      active: { id: "entry:C:\\Users\\todo.txt" },
      over: { id: "up:C:\\" },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("move_path", {
        source: "C:\\Users\\todo.txt",
        destinationDir: "C:\\",
      });
    });
  });

  it("moves an entry when dropped onto a breadcrumb folder", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.doubleClick(usersButton);

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
      expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
    });

    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\Users\\todo.txt" } });
    await dndCallbacks.onDragEnd?.({
      active: { id: "entry:C:\\Users\\todo.txt" },
      over: { id: "breadcrumb:C:\\" },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("move_path", {
        source: "C:\\Users\\todo.txt",
        destinationDir: "C:\\",
      });
    });
  });

  it("navigates up only on double click for .. entry", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.doubleClick(usersButton);

    expect(await screen.findByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();

    const upButton = screen.getByRole("button", { name: /\.\.\s*Up/i });
    fireEvent.click(upButton);

    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();

    fireEvent.doubleClick(upButton);

    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
  });

  it("requires confirmation before leaving workspace root via up navigation", async () => {
    openConfirmMock.mockResolvedValue(false);
    renderFilesystemPanel({
      tabId: "tab-1",
      paneId: "left",
      tabWorkspaceRoot: "C:\\Users",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\Users",
        selectedPaths: [],
        scrollTop: 0,
      },
    });

    expect(await screen.findByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();

    const upButton = screen.getByRole("button", { name: /\.\.\s*Up/i });
    fireEvent.doubleClick(upButton);

    await waitFor(() => {
      expect(openConfirmMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Leave workspace?",
        confirmLabel: "Leave workspace",
      }));
    });
    expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /notes\.txt/i })).not.toBeInTheDocument();
  });

  it("uses breadcrumb root to return to drive selection", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const drivesCrumb = await screen.findByRole("button", { name: "Drives" });
    fireEvent.click(drivesCrumb);

    expect(await screen.findByText("Select a drive")).toBeInTheDocument();
  });

  it("hydrates expanded folder paths from persisted filesystem state", async () => {
    renderFilesystemPanel({
      tabId: "tab-1",
      paneId: "left",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\",
        selectedPaths: [],
        expandedPaths: ["C:\\Users"],
        scrollTop: 0,
      },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_directory", { path: "C:\\Users" });
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Projects/i })).toBeInTheDocument();
    });
  });

  it("hydrates filesystem state and restores scroll per pane", async () => {
    const onFilesystemStateChange = vi.fn();
    renderFilesystemPanel({
      tabId: "tab-1",
      paneId: "left",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\Users",
        selectedPaths: [
          "C:\\Users\\Projects",
          "C:\\Users\\todo.txt",
        ],
        scrollTop: 37,
      },
      onFilesystemStateChange,
    });

    const todoButton = await screen.findByRole("button", { name: /todo\.txt/i });
    const projectsButton = await screen.findByRole("button", { name: /Projects/i });
    expect(todoButton).toHaveAttribute("aria-selected", "true");
    expect(projectsButton).toHaveAttribute("aria-selected", "true");

    const scrollContainer = screen.getByTestId("filesystem-panel-scroll-container");
    expect(scrollContainer.scrollTop).toBe(37);
  });

  it("persists debounced scroll updates", async () => {
    const onFilesystemStateChange = vi.fn();
    renderFilesystemPanel({
      tabId: "tab-2",
      paneId: "left",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\",
        scrollTop: 0,
      },
      onFilesystemStateChange,
    });

    await screen.findByRole("button", { name: /Users/i });
    const scrollContainer = screen.getByTestId("filesystem-panel-scroll-container");
    scrollContainer.scrollTop = 91;
    vi.useFakeTimers();
    try {
      fireEvent.scroll(scrollContainer);
      await advanceTimersBy(520);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ scrollTop: 91 }),
      );
    });
  });

  it("debounces rapid scroll updates and persists only the latest scroll position", async () => {
    const onFilesystemStateChange = vi.fn();
    renderFilesystemPanel({
      tabId: "tab-2",
      paneId: "left",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\",
        scrollTop: 0,
      },
      onFilesystemStateChange,
    });

    await screen.findByRole("button", { name: /Users/i });
    const scrollContainer = screen.getByTestId("filesystem-panel-scroll-container");
    vi.useFakeTimers();
    try {
      scrollContainer.scrollTop = 41;
      fireEvent.scroll(scrollContainer);
      await advanceTimersBy(120);

      scrollContainer.scrollTop = 89;
      fireEvent.scroll(scrollContainer);
      await advanceTimersBy(120);

      scrollContainer.scrollTop = 133;
      fireEvent.scroll(scrollContainer);
      await advanceTimersBy(520);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ scrollTop: 133 }),
      );
    });
    expect(onFilesystemStateChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ scrollTop: 41 }),
    );
    expect(onFilesystemStateChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ scrollTop: 89 }),
    );
  });

  it("window-renders only visible entries in large folders", async () => {
    const makeEntryName = (index) => `file-${String(index).padStart(4, "0")}.txt`;
    const largeEntries = Array.from({ length: 500 }, (_, index) => {
      const name = makeEntryName(index);
      return {
        name,
        path: `C:\\${name}`,
        is_dir: false,
      };
    });

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives") return [{ name: "C:", path: "C:\\" }];
      if (command === "list_directory_page" && payload?.path === "C:\\") {
        const offset = payload?.offset ?? 0;
        const limit = payload?.limit ?? largeEntries.length;
        const pageEntries = largeEntries.slice(offset, offset + limit);
        return {
          entries: pageEntries,
          hasMore: offset + pageEntries.length < largeEntries.length,
          totalCount: largeEntries.length,
        };
      }
      if (command === "list_directory" && payload?.path === "C:\\") return largeEntries;
      if (command === "parent_path" && payload?.path === "C:\\") return null;
      if (
        command === "filesystem_watch_start"
        || command === "filesystem_watch_stop"
        || command === "start_external_drag"
      ) {
        return null;
      }
      if (command === "filesystem_resolve_workspace_folders") {
        const paths = payload?.paths ?? [];
        const result = {};
        paths.forEach((workspacePath) => {
          result[workspacePath] = false;
        });
        return result;
      }
      if (command === "thumbnail_resolve_batch") {
        const items = payload?.request?.items ?? [];
        return {
          results: items.map((item, index) => ({
            sourcePath: item?.sourcePath ?? "",
            bucketPx: 64,
            key: `thumb-large-${index}`,
            status: "pending",
            thumbnailPath: null,
            mime: null,
            error: null,
          })),
        };
      }
      throw new Error(`Unhandled invoke: ${command}`);
    });

    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    expect(await screen.findByRole("button", { name: /file-0000\.txt/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /file-04\d\d\.txt/i })).not.toBeInTheDocument();

    const scrollContainer = screen.getByTestId("filesystem-panel-scroll-container");
    scrollContainer.scrollTop = 12000;
    fireEvent.scroll(scrollContainer);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /file-03\d\d\.txt/i }).length)
        .toBeGreaterThan(0);
    });
    expect(screen.getAllByRole("button", { name: /file-\d{4}\.txt/i }).length).toBeLessThan(450);
  });

  it("imports external files dropped over the filesystem panel", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof externalDropCallback).toBe("function");
      expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
    });

    const panel = screen.getByLabelText("Filesystem panel");
    panel.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    await externalDropCallback?.({
      payload: {
        type: "drop",
        paths: ["D:\\Downloads\\clip.mp4"],
        position: { x: 100, y: 100 },
      },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("import_paths", {
        paths: ["D:\\Downloads\\clip.mp4"],
        destinationDir: "C:\\",
      });
    });

    expect(await screen.findByText("clip.mp4")).toBeInTheDocument();
  });

  it("moves externally dropped files when Shift is held", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof externalDropCallback).toBe("function");
      expect(screen.getByRole("button", { name: /Users/i })).toBeInTheDocument();
    });

    const panel = screen.getByLabelText("Filesystem panel");
    panel.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const usersButton = screen.getByRole("button", { name: /Users/i });
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => usersButton);
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true });
    try {
      await externalDropCallback?.({
        payload: {
          type: "drop",
          paths: ["C:\\notes.txt"],
          position: { x: 100, y: 100 },
        },
      });
    } finally {
      fireEvent.keyUp(window, { key: "Shift", shiftKey: false });
      document.elementFromPoint = originalElementFromPoint;
    }

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("move_path", {
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      });
    });
    expect(invoke).not.toHaveBeenCalledWith("import_paths", {
      paths: ["C:\\notes.txt"],
      destinationDir: "C:\\Users",
    });
  });

  it("imports external files into a hovered folder row", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof externalDropCallback).toBe("function");
      expect(screen.getByRole("button", { name: /Users/i })).toBeInTheDocument();
    });

    const panel = screen.getByLabelText("Filesystem panel");
    panel.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const usersButton = screen.getByRole("button", { name: /Users/i });
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => usersButton);

    await externalDropCallback?.({
      payload: {
        type: "drop",
        paths: ["D:\\Downloads\\clip.mp4"],
        position: { x: 100, y: 100 },
      },
    });

    document.elementFromPoint = originalElementFromPoint;

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("import_paths", {
        paths: ["D:\\Downloads\\clip.mp4"],
        destinationDir: "C:\\Users",
      });
    });
  });

  it("highlights hovered folder row during external drag over", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof externalDropCallback).toBe("function");
      expect(screen.getByRole("button", { name: /Users/i })).toBeInTheDocument();
    });

    const panel = screen.getByLabelText("Filesystem panel");
    panel.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const usersButton = screen.getByRole("button", { name: /Users/i });
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => usersButton);
    try {
      await externalDropCallback?.({
        payload: {
          type: "over",
          paths: [],
          position: { x: 100, y: 100 },
        },
      });

      await waitFor(() => {
        expect(usersButton.className).toMatch(/dropTarget/);
      });

      await externalDropCallback?.({
        payload: {
          type: "leave",
        },
      });

      await waitFor(() => {
        expect(usersButton.className).not.toMatch(/dropTarget/);
      });
    } finally {
      document.elementFromPoint = originalElementFromPoint;
    }
  });

  it("starts inline rename on F2 and commits on Enter", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);
    notesButton.focus();
    fireEvent.keyDown(notesButton, { key: "F2" });

    const renameInput = await screen.findByRole("textbox");
    expect(renameInput).toHaveValue("notes.txt");
    fireEvent.change(renameInput, { target: { value: "renamed.txt" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("rename_path", {
        path: "C:\\notes.txt",
        newName: "renamed.txt",
      });
    });
    expect(await screen.findByRole("button", { name: /renamed\.txt/i })).toBeInTheDocument();
  });

  it("navigates entries with ArrowUp/ArrowDown and supports Shift range selection", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const tempButton = await screen.findByRole("button", { name: /Temp/i });
    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });

    fireEvent.click(usersButton);
    usersButton.focus();
    fireEvent.keyDown(usersButton, { key: "ArrowDown" });

    await waitFor(() => {
      expect(tempButton).toHaveAttribute("aria-selected", "true");
      expect(usersButton).toHaveAttribute("aria-selected", "false");
    });

    tempButton.focus();
    fireEvent.keyDown(tempButton, { key: "ArrowDown", shiftKey: true });

    await waitFor(() => {
      expect(tempButton).toHaveAttribute("aria-selected", "true");
      expect(notesButton).toHaveAttribute("aria-selected", "true");
    });

    notesButton.focus();
    fireEvent.keyDown(notesButton, { key: "ArrowUp" });

    await waitFor(() => {
      expect(tempButton).toHaveAttribute("aria-selected", "true");
      expect(notesButton).toHaveAttribute("aria-selected", "false");
    });
  });

  it("selects up entry and last entry with arrows when nothing is selected", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const panel = screen.getByLabelText("Filesystem panel");
    const upButton = await screen.findByRole("button", { name: /\.\./i });
    const configButton = await screen.findByRole("button", { name: /\.grayspace/i });

    fireEvent.keyDown(panel, { key: "ArrowDown" });
    await waitFor(() => {
      expect(upButton).toHaveAttribute("aria-selected", "true");
    });

    const scrollContainer = screen.getByTestId("filesystem-panel-scroll-container");
    fireEvent.click(scrollContainer);
    await waitFor(() => {
      expect(upButton).toHaveAttribute("aria-selected", "false");
    });

    fireEvent.keyDown(panel, { key: "ArrowUp" });
    await waitFor(() => {
      expect(configButton).toHaveAttribute("aria-selected", "true");
    });
  });

  it("loops keyboard navigation from first to last and last to first", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const panel = screen.getByLabelText("Filesystem panel");
    const upButton = await screen.findByRole("button", { name: /\.\./i });
    const configButton = await screen.findByRole("button", { name: /\.grayspace/i });

    fireEvent.keyDown(panel, { key: "ArrowDown" });
    await waitFor(() => {
      expect(upButton).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.keyDown(panel, { key: "ArrowUp" });
    await waitFor(() => {
      expect(configButton).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.keyDown(panel, { key: "ArrowDown" });
    await waitFor(() => {
      expect(upButton).toHaveAttribute("aria-selected", "true");
    });
  });

  it("supports arrow selection while browsing drives", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "list_drives") {
        return [
          { name: "C:", path: "C:\\" },
          { name: "D:", path: "D:\\" },
        ];
      }
      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") return null;
      if (command === "thumbnail_resolve_batch") return { results: [] };
      throw new Error(`Unhandled invoke: ${command}`);
    });

    renderFilesystemPanel();

    const panel = screen.getByLabelText("Filesystem panel");
    const cDriveButton = await screen.findByRole("button", { name: /C:\\/i });
    const dDriveButton = await screen.findByRole("button", { name: /D:\\/i });

    fireEvent.keyDown(panel, { key: "ArrowDown" });
    await waitFor(() => {
      expect(cDriveButton).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.keyDown(panel, { key: "ArrowDown" });
    await waitFor(() => {
      expect(dDriveButton).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.keyDown(panel, { key: "ArrowUp" });
    await waitFor(() => {
      expect(cDriveButton).toHaveAttribute("aria-selected", "true");
    });
  });

  it("expands and collapses the selected folder with ArrowRight and ArrowLeft", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.click(usersButton);
    usersButton.focus();
    fireEvent.keyDown(usersButton, { key: "ArrowRight" });

    expect(await screen.findByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();

    fireEvent.keyDown(usersButton, { key: "ArrowLeft" });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /todo\.txt/i })).not.toBeInTheDocument();
    });
  });

  it("opens the selected file with Enter", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);
    notesButton.focus();
    fireEvent.keyDown(notesButton, { key: "Enter" });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("open_path", { path: "C:\\notes.txt" });
    });
  });

  it("opens the selected folder in place with Enter", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.click(usersButton);
    usersButton.focus();
    fireEvent.keyDown(usersButton, { key: "Enter" });

    expect(await screen.findByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /notes\.txt/i })).not.toBeInTheDocument();
  });

  it("opens all selected files with Enter", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    const draftButton = await screen.findByRole("button", { name: /draft\.md/i });

    fireEvent.click(notesButton);
    fireEvent.click(draftButton, { ctrlKey: true });
    fireEvent.keyDown(draftButton, { key: "Enter" });

    await waitFor(() => {
      const openPathCalls = invoke.mock.calls.filter(([command]) => command === "open_path");
      const openedPaths = openPathCalls.map(([, payload]) => payload?.path);
      expect(openedPaths).toContain("C:\\notes.txt");
      expect(openedPaths).toContain("C:\\draft.md");
    });
  });

  it("renames a selected folder on F2", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.click(usersButton);
    usersButton.focus();
    fireEvent.keyDown(usersButton, { key: "F2" });

    const renameInput = await screen.findByRole("textbox");
    expect(renameInput).toHaveValue("Users");
    fireEvent.change(renameInput, { target: { value: "People" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("rename_path", {
        path: "C:\\Users",
        newName: "People",
      });
    });
    expect(await screen.findByRole("button", { name: /People/i })).toBeInTheDocument();
  });

  it("keeps renamed folders expanded and refreshes them via watcher", async () => {
    const directoryState = {
      "C:\\": [
        { name: "Users", path: "C:\\Users", is_dir: true },
      ],
      "C:\\Users": [
        { name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false },
      ],
    };

    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives") return [{ name: "C:", path: "C:\\" }];
      if (command === "list_directory_page") {
        const entries = (directoryState[payload?.path] ?? []).map(entry => ({ ...entry }));
        const offset = payload?.offset ?? 0;
        const limit = payload?.limit ?? entries.length;
        const pageEntries = entries.slice(offset, offset + limit);
        return {
          entries: pageEntries,
          hasMore: offset + pageEntries.length < entries.length,
          totalCount: entries.length,
        };
      }
      if (command === "list_directory") return (directoryState[payload?.path] ?? []).map(entry => ({ ...entry }));
      if (command === "filesystem_resolve_workspace_folders") return {};
      if (command === "parent_path") {
        if (payload?.path === "C:\\") return null;
        return path.win32.dirname(payload?.path ?? "");
      }
      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") return null;
      if (command === "thumbnail_resolve_batch") return { results: [] };
      if (command === "rename_path") {
        const sourcePath = payload?.path ?? "";
        const nextName = payload?.newName ?? "";
        const parentPath = path.win32.dirname(sourcePath);
        const sourceEntries = directoryState[parentPath] ?? [];
        const sourceEntry = sourceEntries.find(entry => entry.path === sourcePath);
        if (!sourceEntry) throw new Error("Missing source entry");

        const renamedPath = path.win32.join(parentPath, nextName);
        const remapPath = (candidatePath) => {
          if (candidatePath === sourcePath) return renamedPath;
          if (sourceEntry.is_dir && candidatePath.startsWith(`${sourcePath}\\`))
            return `${renamedPath}${candidatePath.slice(sourcePath.length)}`;
          return candidatePath;
        };
        const nextDirectoryState = {};
        Object.entries(directoryState).forEach(([directoryPath, directoryEntries]) => {
          const remappedDirectoryPath = remapPath(directoryPath);
          nextDirectoryState[remappedDirectoryPath] = directoryEntries.map((entry) => {
            const remappedEntryPath = remapPath(entry.path);
            if (remappedEntryPath === entry.path) return entry;
            return {
              ...entry,
              name: entry.path === sourcePath ? nextName : entry.name,
              path: remappedEntryPath,
            };
          });
        });
        Object.keys(directoryState).forEach((key) => {
          delete directoryState[key];
        });
        Object.assign(directoryState, nextDirectoryState);

        return {
          path: renamedPath,
          name: nextName,
          requestedName: nextName,
          adjusted: false,
        };
      }
      throw new Error(`Unhandled invoke: ${command}`);
    });

    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const usersExpander = usersButton.querySelector("[data-entry-expander]");
    expect(usersExpander).toBeTruthy();
    fireEvent.click(usersExpander);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
    });

    fireEvent.click(usersButton);
    usersButton.focus();
    fireEvent.keyDown(usersButton, { key: "F2" });
    const renameInput = await screen.findByRole("textbox");
    fireEvent.change(renameInput, { target: { value: "People" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /People/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
    });

    const peopleWatchStartCall = [...invoke.mock.calls]
      .reverse()
      .find(([command, args]) => (
        command === "filesystem_watch_start" && args?.path === "C:\\People"
      ));
    const peopleWatchId = peopleWatchStartCall?.[1]?.watchId;
    expect(typeof peopleWatchId).toBe("string");

    directoryState["C:\\People"].push({
      name: "later.txt",
      path: "C:\\People\\later.txt",
      is_dir: false,
    });

    vi.useFakeTimers();
    try {
      await filesystemWatchCallback?.({
        payload: {
          watchId: peopleWatchId,
          changedPath: "C:\\People\\later.txt",
        },
      });
      await advanceTimersBy(160);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /later\.txt/i })).toBeInTheDocument();
    });
  });

  it("starts rename from app command events", async () => {
    renderFilesystemPanel({
      paneId: "pane-event",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.renameSelected",
        context: {
          targetPaneId: "pane-event",
        },
        },
      }));
    });

    expect(await screen.findByRole("textbox")).toHaveValue("notes.txt");
  });

  it("focuses breadcrumb input from app command events", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-focus-breadcrumb",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    expect(await screen.findByRole("navigation", { name: "Current path" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Current folder path" })).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
          commandId: "filesystem.focusBreadcrumbInput",
          context: {
            targetPaneId: "pane-event-focus-breadcrumb",
          },
        },
      }));
    });

    const pathInput = await screen.findByRole("textbox", { name: "Current folder path" });
    expect(pathInput).toHaveFocus();
  });

  it("navigates backward and forward from filesystem app command events", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-history-navigation",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.doubleClick(usersButton);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
    });

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
          commandId: "filesystem.navigateBack",
          context: {
            targetPaneId: "pane-event-history-navigation",
          },
        },
      }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /todo\.txt/i })).not.toBeInTheDocument();
    });

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
          commandId: "filesystem.navigateForward",
          context: {
            targetPaneId: "pane-event-history-navigation",
          },
        },
      }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
    });
  });

  it("navigates backward and forward from header history buttons", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const historyBackButton = await screen.findByRole("button", {
      name: "Go back in folder history",
    });
    const historyForwardButton = screen.getByRole("button", {
      name: "Go forward in folder history",
    });
    expect(historyBackButton).toBeEnabled();
    expect(historyForwardButton).toBeDisabled();

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.doubleClick(usersButton);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
    });

    fireEvent.click(historyBackButton);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /todo\.txt/i })).not.toBeInTheDocument();
    });
    expect(historyForwardButton).toBeEnabled();

    fireEvent.click(historyBackButton);
    await waitFor(() => {
      expect(screen.getByText("Select a drive")).toBeInTheDocument();
    });

    fireEvent.click(historyForwardButton);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
    });
  });

  it("creates a new text file from app command events and starts rename", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-create-text",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.createTextFile",
        context: {
          targetPaneId: "pane-event-create-text",
        },
        },
      }));
    });

    expect(await screen.findByRole("textbox")).toHaveValue("untitled.txt");
  });

  it("creates a new folder from app command events and starts rename", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-create-folder",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.createFolder",
        context: {
          targetPaneId: "pane-event-create-folder",
        },
        },
      }));
    });

    expect(await screen.findByRole("textbox")).toHaveValue("New folder");
  });

  it("creates a sibling when a file is selected", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-create-sibling",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.createFolder",
        context: {
          targetPaneId: "pane-event-create-sibling",
        },
        },
      }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_folder", {
        parentDir: "C:\\",
        name: "New folder",
      });
    });
  });

  it("creates a child when a folder is selected", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-create-child",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.click(usersButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.createTextFile",
        context: {
          targetPaneId: "pane-event-create-child",
        },
        },
      }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_text_file", {
        parentDir: "C:\\Users",
        name: "untitled.txt",
      });
    });
  });

  it("uses the first selected entry when creating with multi-selection", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-create-multi",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const usersExpander = usersButton.querySelector("[data-entry-expander]");
    expect(usersExpander).toBeTruthy();
    fireEvent.click(usersExpander);

    const todoButton = await screen.findByRole("button", { name: /todo\.txt/i });
    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(todoButton);
    fireEvent.click(notesButton, { ctrlKey: true });

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.createFolder",
        context: {
          targetPaneId: "pane-event-create-multi",
        },
        },
      }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_folder", {
        parentDir: "C:\\Users",
        name: "New folder",
      });
    });
  });

  it("creates in current root from filesystem panel context menu", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-create-panel-context",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.click(usersButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.createTextFile",
        context: {
          source: "context-menu",
          targetPaneId: "pane-event-create-panel-context",
          targetType: "panel",
          targetPanelType: "Filesystem",
        },
        },
      }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_text_file", {
        parentDir: "C:\\",
        name: "untitled.txt",
      });
    });
  });

  it("creates inside clicked folder from folder context menu", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-create-folder-context",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.createFolder",
        context: {
          source: "context-menu",
          targetPaneId: "pane-event-create-folder-context",
          targetType: "folder",
          targetScope: "tree-entry",
          targetPath: "C:\\Users",
        },
        },
      }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_folder", {
        parentDir: "C:\\Users",
        name: "New folder",
      });
    });
  });

  it("opens a selected folder in a new tab from app command events", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-open-folder",
      tabId: "tab-1",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const tempFolderButton = await screen.findByRole("button", { name: /Temp/i });
    fireEvent.click(tempFolderButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.openSelectedFolderInNewTab",
        context: {
          targetPaneId: "pane-event-open-folder",
        },
        },
      }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("workspace_open_folder_from_tab", {
        payload: {
          tabId: "tab-1",
          path: "C:\\Temp",
        },
      });
    });
  });

  it("copies selected entries and pastes them into the current folder from app command events", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-copy-paste",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.copy",
        context: {
          targetPaneId: "pane-event-copy-paste",
        },
        },
      }));
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.paste",
        context: {
          targetPaneId: "pane-event-copy-paste",
        },
        },
      }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("import_paths", {
        paths: ["C:\\notes.txt"],
        destinationDir: "C:\\",
      });
    });
    await flushPromises();
  });

  it("pastes into the selected folder when one is selected", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-copy-paste-selected-folder",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.copy",
        context: {
          targetPaneId: "pane-event-copy-paste-selected-folder",
        },
        },
      }));
    });

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.click(usersButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.paste",
        context: {
          targetPaneId: "pane-event-copy-paste-selected-folder",
        },
        },
      }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("import_paths", {
        paths: ["C:\\notes.txt"],
        destinationDir: "C:\\Users",
      });
    });
  });

  it("pastes next to the selected file when no folder is selected", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-copy-paste-selected-file-neighbor",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.copy",
        context: {
          targetPaneId: "pane-event-copy-paste-selected-file-neighbor",
        },
        },
      }));
    });

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const usersExpander = usersButton.querySelector("[data-entry-expander]");
    expect(usersExpander).toBeTruthy();
    fireEvent.click(usersExpander);

    const todoButton = await screen.findByRole("button", { name: /todo\.txt/i });
    fireEvent.click(todoButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.paste",
        context: {
          targetPaneId: "pane-event-copy-paste-selected-file-neighbor",
        },
        },
      }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("import_paths", {
        paths: ["C:\\notes.txt"],
        destinationDir: "C:\\Users",
      });
    });
  });

  it("uses context selection for copy commands", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-copy-context-selection",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.copy",
        context: {
          source: "context-menu",
          targetPaneId: "pane-event-copy-context-selection",
          targetType: "file",
          targetScope: "tree-entry",
          selectedPaths: ["C:\\draft.md"],
        },
        },
      }));
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.paste",
        context: {
          targetPaneId: "pane-event-copy-context-selection",
        },
        },
      }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("import_paths", {
        paths: ["C:\\draft.md"],
        destinationDir: "C:\\",
      });
    });
    await flushPromises();
  });

  it("cuts selected entries, pastes into folder context target, and clears cut clipboard", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-cut-paste",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.cut",
        context: {
          targetPaneId: "pane-event-cut-paste",
        },
        },
      }));
    });

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.paste",
        context: {
          source: "context-menu",
          targetPaneId: "pane-event-cut-paste",
          targetType: "folder",
          targetScope: "tree-entry",
          targetPath: "C:\\Users",
        },
        },
      }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("move_path", {
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      });
    });

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.paste",
        context: {
          source: "context-menu",
          targetPaneId: "pane-event-cut-paste",
          targetType: "folder",
          targetScope: "tree-entry",
          targetPath: "C:\\Users",
        },
        },
      }));
    });

    await waitFor(() => {
      const moveCalls = invoke.mock.calls.filter(([command, args]) => (
        command === "move_path"
        && args?.source === "C:\\notes.txt"
        && args?.destinationDir === "C:\\Users"
      ));
      expect(moveCalls).toHaveLength(1);
    });
  });

  it("selects the right-clicked entry when it is outside current selection", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });

    fireEvent.click(usersButton);
    fireEvent.contextMenu(notesButton);

    await waitFor(() => {
      expect(notesButton).toHaveAttribute("aria-selected", "true");
      expect(usersButton).toHaveAttribute("aria-selected", "false");
    });
  });

  it("clears selection when right-clicking empty panel space", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    const scrollContainer = screen.getByTestId("filesystem-panel-scroll-container");
    fireEvent.click(notesButton);

    await waitFor(() => {
      expect(notesButton).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.contextMenu(scrollContainer);

    await waitFor(() => {
      expect(notesButton).toHaveAttribute("aria-selected", "false");
    });
  });

  it("clears selection on left-click empty space but keeps it on middle-click", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    const scrollContainer = screen.getByTestId("filesystem-panel-scroll-container");
    fireEvent.click(notesButton);
    fireEvent.click(scrollContainer, { button: 1 });

    await waitFor(() => {
      expect(notesButton).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.click(scrollContainer);

    await waitFor(() => {
      expect(notesButton).toHaveAttribute("aria-selected", "false");
    });
  });

  it("cancels inline rename on Escape", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);
    notesButton.focus();
    fireEvent.keyDown(notesButton, { key: "F2" });

    const renameInput = await screen.findByRole("textbox");
    fireEvent.change(renameInput, { target: { value: "renamed.txt" } });
    fireEvent.keyDown(renameInput, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
    expect(invoke).not.toHaveBeenCalledWith("rename_path", expect.objectContaining({
      path: "C:\\notes.txt",
      newName: "renamed.txt",
    }));
    expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
  });

  it("treats empty blur rename as a no-op", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);
    notesButton.focus();
    fireEvent.keyDown(notesButton, { key: "F2" });

    const renameInput = await screen.findByRole("textbox");
    fireEvent.change(renameInput, { target: { value: "   " } });
    fireEvent.blur(renameInput);

    await waitFor(() => {
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
    expect(invoke).not.toHaveBeenCalledWith("rename_path", expect.objectContaining({
      path: "C:\\notes.txt",
    }));
    expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
  });

  it("undos and redos a rename with ctrl+z and ctrl+y", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);
    notesButton.focus();
    fireEvent.keyDown(notesButton, { key: "F2" });

    const renameInput = await screen.findByRole("textbox");
    fireEvent.change(renameInput, { target: { value: "renamed.txt" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    const renamedButton = await screen.findByRole("button", { name: /renamed\.txt/i });
    fireEvent.click(renamedButton);
    renamedButton.focus();
    fireEvent.keyDown(renamedButton, { key: "z", ctrlKey: true });

    const restoredButton = await screen.findByRole("button", { name: /notes\.txt/i });
    expect(restoredButton).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("rename_path", {
      path: "C:\\renamed.txt",
      newName: "notes.txt",
      allowAdjustment: false,
    });

    fireEvent.click(restoredButton);
    restoredButton.focus();
    fireEvent.keyDown(restoredButton, { key: "y", ctrlKey: true });
    expect(await screen.findByRole("button", { name: /renamed\.txt/i })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("rename_path", {
      path: "C:\\notes.txt",
      newName: "renamed.txt",
      allowAdjustment: false,
    });
  });

  it("opens confirmation and deletes selected entries on Delete key", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);
    fireEvent.keyDown(notesButton, { key: "Delete" });

    await waitFor(() => {
      expect(openConfirmMock).toHaveBeenCalledWith(expect.objectContaining({
        title: "Delete selected items?",
        confirmLabel: "Delete",
      }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_paths", {
        paths: ["C:\\notes.txt"],
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /notes\.txt/i })).not.toBeInTheDocument();
    });
  });

  it("deletes selected entries from app command events", async () => {
    renderFilesystemPanel({
      paneId: "pane-event-delete",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
        commandId: "filesystem.deleteSelected",
        context: {
          targetPaneId: "pane-event-delete",
        },
        },
      }));
    });

    await waitFor(() => {
      expect(openConfirmMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_paths", {
        paths: ["C:\\notes.txt"],
      });
    });
  });

  it("does not delete when Delete confirmation is cancelled", async () => {
    openConfirmMock.mockResolvedValue(false);
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);
    fireEvent.keyDown(notesButton, { key: "Delete" });

    await waitFor(() => {
      expect(openConfirmMock).toHaveBeenCalled();
    });
    expect(invoke).not.toHaveBeenCalledWith("delete_paths", expect.anything());
    expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
  });
});

