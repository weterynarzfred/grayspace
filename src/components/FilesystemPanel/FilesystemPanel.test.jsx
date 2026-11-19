import path from "node:path";
import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { cursorPosition } from "@tauri-apps/api/window";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import FilesystemPanel from "./FilesystemPanel";
import { clearFilesystemClipboardState } from "./filesystemClipboardStore";
import PanelsDndLayer from "../PanelsDndLayer";
import { APP_COMMAND_EVENT } from "../../commands/commandEvents";
import { COMMAND_IDS, isCommandShortcutMatch } from "../../commands/commandRegistry";
import executeCommand from "../../commands/executeCommand";
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
let filesystemSearchCallback;

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
    if (eventName === "filesystem-search-results") filesystemSearchCallback = runInAsyncAct(handler);
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
        const folderEntries = directoryState[payload?.path];
        if (!folderEntries)
          throw new Error(`Unhandled list_directory_page path: ${payload?.path}`);

        const filter = (payload?.filter ?? "").toLowerCase();
        const entries = folderEntries.filter((entry) => entry.name.toLowerCase().includes(filter));
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

      if (command === "filesystem_search_start" || command === "filesystem_search_cancel")
        return null;

      if (command === "filesystem_transfer_conflicts")
        return [];

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
      if (command === "filesystem_transfer_conflicts")
        return [];

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

  // Entries pushed into the returned array show up in later listings of C:\Users, like files
  // another program creates there.
  function mockLaterUsersEntries() {
    const laterEntries = [];
    const baseInvoke = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => (
      command === "list_directory" && payload?.path === "C:\\Users"
        ? [...await baseInvoke(command, payload), ...laterEntries]
        : baseInvoke(command, payload)
    ));
    return laterEntries;
  }

  it("keeps refreshing opened folders when one persisted open folder can no longer be watched", async () => {
    const laterUsersEntries = mockLaterUsersEntries();
    const baseInvoke = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "filesystem_watch_start" && payload?.path === "C:\\Gone")
        throw new Error("The system cannot find the path specified.");
      return baseInvoke(command, payload);
    });
    renderFilesystemPanel({
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\",
        scrollTop: 0,
        expandedPaths: ["C:\\Gone", "C:\\Users"],
      },
    });
    await screen.findByRole("button", { name: /todo\.txt/i });

    let usersWatchId;
    await waitFor(() => {
      usersWatchId = invoke.mock.calls.find(([command, args]) => (
        command === "filesystem_watch_start" && args?.path === "C:\\Users"
      ))?.[1]?.watchId;
      expect(usersWatchId).toEqual(expect.any(String));
    });
    laterUsersEntries.push({ name: "later.txt", path: "C:\\Users\\later.txt", is_dir: false });

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

    expect(await screen.findByRole("button", { name: /later\.txt/i })).toBeInTheDocument();
  });

  it("lists a folder again when it is reopened, since it was not watched while closed", async () => {
    const laterUsersEntries = mockLaterUsersEntries();
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);
    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const usersExpander = usersButton.querySelector("[data-entry-expander]");
    fireEvent.click(usersExpander);
    await screen.findByRole("button", { name: /todo\.txt/i });
    fireEvent.click(usersExpander);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /todo\.txt/i })).not.toBeInTheDocument();
    });

    laterUsersEntries.push({ name: "later.txt", path: "C:\\Users\\later.txt", is_dir: false });
    fireEvent.click(usersExpander);

    expect(await screen.findByRole("button", { name: /later\.txt/i })).toBeInTheDocument();
    const usersListings = invoke.mock.calls.filter(([command, args]) => (
      command === "list_directory" && args?.path === "C:\\Users"
    ));
    expect(usersListings).toHaveLength(2);
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
      previewOpenMode: "ephemeral",
    });

    fireEvent.click(fileButton, { ctrlKey: true });
    expect(onTabSelectedFilesChange).toHaveBeenLastCalledWith({
      selectedPaths: [],
      selectedEntryKinds: {},
      previewOpenMode: "ephemeral",
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

  it("cycles thumbnail sizes and requests the matching cached thumbnail size", async () => {
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
      expect(getLatestThumbnailSizeHint()).toBe(64);
    });

    // Rust caches 64 px thumbnails up to 64 px and 256 px ones above that.
    for (const [sizeLabel, cachedSizePx] of [
      ["32px", 64], ["48px", 64], ["64px", 64], ["96px", 256],
      ["128px", 256], ["192px", 256], ["256px", 256], ["22px", 64],
    ]) {
      fireEvent.click(sizeButton);
      expect(sizeButton).toHaveTextContent(sizeLabel);
      await waitFor(() => {
        expect(getLatestThumbnailSizeHint()).toBe(cachedSizePx);
      });
    }
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
      expect(latestState?.thumbnailSizePx).toBe(32);
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

  it("opens breadcrumb folders in a new tab on middle click without the workspace-exit confirmation", async () => {
    renderFilesystemPanel({
      tabId: "tab-1",
      tabWorkspaceRoot: "C:\\Users",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\Users\\Projects",
        selectedPaths: [],
      },
    });

    const breadcrumbNav = await screen.findByRole("navigation", { name: "Current path" });
    const driveCrumb = within(breadcrumbNav).getByRole("button", { name: "C:" });
    fireEvent.mouseDown(driveCrumb, { button: 1 });
    fireEvent.mouseUp(driveCrumb, { button: 1 });

    // The fixture's C:\ holds a .grayspace folder, so it opens as a workspace.
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("workspace_open_workspace_folder_from_tab", {
        payload: {
          tabId: "tab-1",
          workspaceRoot: "C:\\",
        },
      });
    });
    expect(openConfirmMock).not.toHaveBeenCalled();
    expect(within(breadcrumbNav).getByRole("button", { name: "Projects" })).toBeInTheDocument();
  });

  it("opens a non-workspace breadcrumb folder in a new tab on middle click", async () => {
    renderFilesystemPanel({
      tabId: "tab-1",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\Temp",
        selectedPaths: [],
      },
    });

    const breadcrumbNav = await screen.findByRole("navigation", { name: "Current path" });
    const tempCrumb = within(breadcrumbNav).getByRole("button", { name: "Temp" });
    fireEvent.mouseDown(tempCrumb, { button: 1 });
    fireEvent.mouseUp(tempCrumb, { button: 1 });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("workspace_open_folder_from_tab", {
        payload: {
          tabId: "tab-1",
          path: "C:\\Temp",
        },
      });
    });
  });

  it("opens drives in a new tab on middle click", async () => {
    renderFilesystemPanel({ tabId: "tab-1" });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.mouseDown(driveButton, { button: 1 });
    fireEvent.mouseUp(driveButton, { button: 1 });

    // The fixture's C:\ holds a .grayspace folder, so it opens as a workspace.
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("workspace_open_workspace_folder_from_tab", {
        payload: {
          tabId: "tab-1",
          workspaceRoot: "C:\\",
        },
      });
    });
    expect(screen.queryByRole("navigation", { name: "Current path" })).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("list_directory_page", expect.objectContaining({ path: "C:\\" }));
  });

  it("keeps the drive list when a middle-clicked drive fails to open", async () => {
    const baseInvoke = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives") return [{ name: "C:", path: "C:\\" }, { name: "E:", path: "E:\\" }];
      if (command === "workspace_open_folder_from_tab") throw "Folder does not exist.";
      return baseInvoke(command, payload);
    });
    renderFilesystemPanel({ tabId: "tab-1" });

    const removedDrive = await screen.findByRole("button", { name: /E:\\/i });
    fireEvent.mouseDown(removedDrive, { button: 1 });
    fireEvent.mouseUp(removedDrive, { button: 1 });

    expect(await screen.findByText("Folder does not exist.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /C:\\/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /E:\\/i })).toBeInTheDocument();
  });

  it("opens middle-clicked files as pinned preview entries", async () => {
    const onTabSelectedFilesChange = vi.fn();
    renderFilesystemPanel({
      tabId: "tab-1",
      onTabSelectedFilesChange,
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const fileButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.mouseDown(fileButton, { button: 1 });
    fireEvent.mouseUp(fileButton, { button: 1 });

    expect(onTabSelectedFilesChange).toHaveBeenLastCalledWith({
      selectedPaths: ["C:\\notes.txt"],
      selectedEntryKinds: {
        "C:\\notes.txt": "file",
      },
      previewOpenMode: "pinned",
    });
    expect(invoke).not.toHaveBeenCalledWith("open_path", { path: "C:\\notes.txt" });
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
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      }));
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
      expect(invoke).toHaveBeenCalledWith("import_paths", expect.objectContaining({
        paths: ["C:\\notes.txt"],
        destinationDir: "C:\\Users",
      }));
    });

    expect(invoke).not.toHaveBeenCalledWith("move_path", expect.objectContaining({
      source: "C:\\notes.txt",
      destinationDir: "C:\\Users",
    }));
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
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      }));
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

    expect(invoke).not.toHaveBeenCalledWith("move_path", expect.objectContaining({
      source: "C:\\notes.txt",
      destinationDir: "C:\\draft.md",
    }));
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
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      }));
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
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
        source: "C:\\Users\\todo.txt",
        destinationDir: "C:\\",
      }));
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
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      }));
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
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      }));
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
        source: "C:\\draft.md",
        destinationDir: "C:\\Users",
      }));
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

    expect(invoke).not.toHaveBeenCalledWith("move_path", expect.objectContaining({
      source: "C:\\notes.txt",
      destinationDir: "C:\\Users",
    }));
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
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      }));
    });
    expect(invoke).not.toHaveBeenCalledWith("import_paths", expect.objectContaining({
      paths: ["C:\\notes.txt"],
      destinationDir: "C:\\Users",
    }));
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
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      }));
    });
    expect(invoke).not.toHaveBeenCalledWith("import_paths", expect.objectContaining({
      paths: ["\\\\?\\C:\\notes.txt"],
      destinationDir: "C:\\Users",
    }));
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
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
        source: "C:\\Users\\todo.txt",
        destinationDir: "C:\\",
      }));
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
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
        source: "C:\\Users\\todo.txt",
        destinationDir: "C:\\",
      }));
    });
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
      expect(invoke).toHaveBeenCalledWith("list_directory", {
        path: "C:\\Users",
        sortKey: "name",
        sortDescending: false,
      });
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

  it("persists rapid scroll updates and keeps the latest scroll position", async () => {
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
    const latestPersistedState = onFilesystemStateChange.mock.calls.at(-1)?.[0];
    expect(latestPersistedState).toEqual(expect.objectContaining({ scrollTop: 133 }));
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
      if (command === "filesystem_transfer_conflicts")
        return [];

      throw new Error(`Unhandled invoke: ${command}`);
    });

    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    expect(await screen.findByRole("button", { name: /file-0000\.txt/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /file-04\d\d\.txt/i })).not.toBeInTheDocument();

    const scrollContainer = screen.getByTestId("filesystem-panel-scroll-container");
    scrollContainer.scrollTop = 7000;
    fireEvent.scroll(scrollContainer);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /file-03\d\d\.txt/i }).length)
        .toBeGreaterThan(0);
    });
    expect(screen.getAllByRole("button", { name: /file-\d{4}\.txt/i }).length).toBeLessThan(450);
  });

  it("gives the scroll body its positioning class, so the list windows measure their rows from it", async () => {
    renderFilesystemPanel();
    await screen.findByRole("button", { name: /C:\\/i });

    // Test CSS modules resolve any class name: this checks the class is applied, not its rule.
    expect(screen.getByTestId("filesystem-panel-scroll-container").className).toMatch(/panelScrollBody/);
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
      expect(invoke).toHaveBeenCalledWith("import_paths", expect.objectContaining({
        paths: ["D:\\Downloads\\clip.mp4"],
        destinationDir: "C:\\",
      }));
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
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
      }));
    });
    expect(invoke).not.toHaveBeenCalledWith("import_paths", expect.objectContaining({
      paths: ["C:\\notes.txt"],
      destinationDir: "C:\\Users",
    }));
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
      expect(invoke).toHaveBeenCalledWith("import_paths", expect.objectContaining({
        paths: ["D:\\Downloads\\clip.mp4"],
        destinationDir: "C:\\Users",
      }));
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

  it.each(["folder-tree", "details", "grid"])("extends a range one more step with each Shift+ArrowUp in %s view", async (viewType) => {
    renderFilesystemPanel({
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0, viewType },
    });

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    const tempButton = screen.getByRole("button", { name: /Temp/i });
    const notesButton = screen.getByRole("button", { name: /notes\.txt/i });
    const draftButton = screen.getByRole("button", { name: /draft\.md/i });

    fireEvent.click(draftButton);
    fireEvent.keyDown(draftButton, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(draftButton, { key: "ArrowUp", shiftKey: true });

    await waitFor(() => {
      expect(tempButton).toHaveAttribute("aria-selected", "true");
    });
    expect(notesButton).toHaveAttribute("aria-selected", "true");
    expect(draftButton).toHaveAttribute("aria-selected", "true");
    expect(usersButton).toHaveAttribute("aria-selected", "false");

    // draft.md stays the anchor, so Shift+ArrowDown takes the top step back.
    fireEvent.keyDown(draftButton, { key: "ArrowDown", shiftKey: true });
    await waitFor(() => {
      expect(tempButton).toHaveAttribute("aria-selected", "false");
    });
    expect(notesButton).toHaveAttribute("aria-selected", "true");
    expect(draftButton).toHaveAttribute("aria-selected", "true");
  });

  // Paths of the entries shown as selected, in list order.
  function getShownSelection() {
    return Array.from(document.querySelectorAll("[data-context-id][aria-selected='true']"))
      .map((element) => element.dataset.contextId);
  }

  it("stops a Shift+arrow range at the first and the last entry instead of looping", async () => {
    renderFilesystemPanel({
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    const tempButton = await screen.findByRole("button", { name: /Temp/i });
    const draftButton = screen.getByRole("button", { name: /draft\.md/i });

    fireEvent.click(tempButton);
    fireEvent.keyDown(tempButton, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(tempButton, { key: "ArrowUp", shiftKey: true });
    expect(getShownSelection()).toEqual(["C:\\Users", "C:\\Temp"]);

    fireEvent.click(draftButton);
    fireEvent.keyDown(draftButton, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(draftButton, { key: "ArrowDown", shiftKey: true });
    expect(getShownSelection()).toEqual(["C:\\draft.md", "C:\\.grayspace"]);
  });

  it("moves on with plain arrows from the top of a range built upwards", async () => {
    renderFilesystemPanel({
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    const draftButton = await screen.findByRole("button", { name: /draft\.md/i });

    fireEvent.click(draftButton);
    fireEvent.keyDown(draftButton, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(draftButton, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(draftButton, { key: "ArrowDown" });

    expect(getShownSelection()).toEqual(["C:\\notes.txt"]);
  });

  it("moves on with plain arrows from the item last Ctrl+clicked, even one that was deselected", async () => {
    renderFilesystemPanel({
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    const usersButton = await screen.findByRole("button", { name: /Users/i });

    fireEvent.click(screen.getByRole("button", { name: /notes\.txt/i }));
    fireEvent.click(usersButton, { ctrlKey: true });
    fireEvent.click(usersButton, { ctrlKey: true });
    fireEvent.keyDown(usersButton, { key: "ArrowDown" });

    expect(getShownSelection()).toEqual(["C:\\Temp"]);
  });

  it("moves on with plain arrows from the last shown selected item once the folder holding the focus is closed", async () => {
    renderFilesystemPanel({
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0, expandedPaths: ["C:\\Users"] },
    });
    const todoButton = await screen.findByRole("button", { name: /todo\.txt/i });
    const draftButton = screen.getByRole("button", { name: /draft\.md/i });

    fireEvent.click(draftButton);
    fireEvent.click(todoButton, { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: /Users/i }).querySelector("[data-entry-expander]"));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /todo\.txt/i })).not.toBeInTheDocument();
    });
    fireEvent.keyDown(draftButton, { key: "ArrowDown" });

    expect(getShownSelection()).toEqual(["C:\\.grayspace"]);
  });

  it("selects first entry and last entry with arrows when nothing is selected", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const panel = screen.getByLabelText("Filesystem panel");
    const firstButton = await screen.findByRole("button", { name: /^Users/i });
    const configButton = await screen.findByRole("button", { name: /\.grayspace/i });

    fireEvent.keyDown(panel, { key: "ArrowDown" });
    await waitFor(() => {
      expect(firstButton).toHaveAttribute("aria-selected", "true");
    });

    const scrollContainer = screen.getByTestId("filesystem-panel-scroll-container");
    fireEvent.click(scrollContainer);
    await waitFor(() => {
      expect(firstButton).toHaveAttribute("aria-selected", "false");
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
    const firstButton = await screen.findByRole("button", { name: /^Users/i });
    const configButton = await screen.findByRole("button", { name: /\.grayspace/i });

    fireEvent.keyDown(panel, { key: "ArrowDown" });
    await waitFor(() => {
      expect(firstButton).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.keyDown(panel, { key: "ArrowUp" });
    await waitFor(() => {
      expect(configButton).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.keyDown(panel, { key: "ArrowDown" });
    await waitFor(() => {
      expect(firstButton).toHaveAttribute("aria-selected", "true");
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
      if (command === "filesystem_transfer_conflicts")
        return [];

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
      if (command === "filesystem_transfer_conflicts")
        return [];

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

  it("opens a closed folder only once the folder created in it exists, so the rename box shows", async () => {
    const createFolderGate = Promise.withResolvers();
    const baseInvoke = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "create_folder") await createFolderGate.promise;
      return baseInvoke(command, payload);
    });
    renderFilesystemPanel({
      paneId: "pane-create-in-closed-folder",
    });

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);
    await screen.findByRole("button", { name: /Users/i });

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
          commandId: "filesystem.createFolder",
          context: {
            source: "context-menu",
            targetPaneId: "pane-create-in-closed-folder",
            targetType: "folder",
            targetScope: "tree-entry",
            targetPath: "C:\\Users",
          },
        },
      }));
    });
    await flushPromises();
    expect(invoke).not.toHaveBeenCalledWith("list_directory", expect.objectContaining({ path: "C:\\Users" }));

    await act(async () => {
      createFolderGate.resolve();
    });

    expect(await screen.findByRole("textbox")).toHaveValue("New folder");
    expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
  });

  it("keeps a folder opened by hand during a create in it open, and lists it again for the rename box", async () => {
    const createFolderGate = Promise.withResolvers();
    const baseInvoke = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "create_folder") await createFolderGate.promise;
      return baseInvoke(command, payload);
    });
    renderFilesystemPanel({
      paneId: "pane-open-during-create",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    const usersButton = await screen.findByRole("button", { name: /Users/i });

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
          commandId: "filesystem.createFolder",
          context: {
            source: "context-menu",
            targetPaneId: "pane-open-during-create",
            targetType: "folder",
            targetScope: "tree-entry",
            targetPath: "C:\\Users",
          },
        },
      }));
    });
    await flushPromises();
    // Listed before the new folder exists.
    fireEvent.click(usersButton.querySelector("[data-entry-expander]"));
    await screen.findByRole("button", { name: /todo\.txt/i });

    await act(async () => {
      createFolderGate.resolve();
    });

    expect(await screen.findByRole("textbox")).toHaveValue("New folder");
    expect(screen.getByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
  });

  it("leaves a folder closed if the pane moved elsewhere while something was created in it", async () => {
    const createFolderGate = Promise.withResolvers();
    const baseInvoke = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "create_folder") await createFolderGate.promise;
      return baseInvoke(command, payload);
    });
    // No tabId: C:\ holds .grayspace, and with a tab Temp would open in a new tab instead.
    renderFilesystemPanel({
      paneId: "pane-leave-during-create",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    await screen.findByRole("button", { name: /Users/i });

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
          commandId: "filesystem.createFolder",
          context: {
            source: "context-menu",
            targetPaneId: "pane-leave-during-create",
            targetType: "folder",
            targetScope: "tree-entry",
            targetPath: "C:\\Users",
          },
        },
      }));
    });
    await flushPromises();
    fireEvent.doubleClick(screen.getByRole("button", { name: /Temp/i }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Users/i })).not.toBeInTheDocument();
    });
    await act(async () => {
      createFolderGate.resolve();
    });
    await flushPromises();

    expect(invoke).not.toHaveBeenCalledWith("list_directory", expect.objectContaining({ path: "C:\\Users" }));
  });

  it("lists a folder in the current sort after a create in it, even if the sort changed meanwhile", async () => {
    const createFolderGate = Promise.withResolvers();
    const baseInvoke = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "create_folder") await createFolderGate.promise;
      return baseInvoke(command, payload);
    });
    renderFilesystemPanel({
      paneId: "pane-sort-during-create",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0, expandedPaths: ["C:\\Users"] },
    });
    // Listed once, then closed: cached, so the create re-lists it.
    const usersButton = await screen.findByRole("button", { name: /Users/i });
    await screen.findByRole("button", { name: /todo\.txt/i });
    fireEvent.click(usersButton.querySelector("[data-entry-expander]"));

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
          commandId: "filesystem.createFolder",
          context: {
            source: "context-menu",
            targetPaneId: "pane-sort-during-create",
            targetType: "folder",
            targetScope: "tree-entry",
            targetPath: "C:\\Users",
          },
        },
      }));
    });
    await flushPromises();
    dispatchFilesystemCommand("filesystem.sort.reverse", "pane-sort-during-create");
    await flushPromises();
    await act(async () => {
      createFolderGate.resolve();
    });
    await screen.findByRole("textbox");

    const usersListings = invoke.mock.calls.filter(([command, args]) => command === "list_directory" && args.path === "C:\\Users");
    expect(usersListings.at(-1)[1]).toEqual(expect.objectContaining({ sortDescending: true }));
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
      expect(invoke).toHaveBeenCalledWith("import_paths", expect.objectContaining({
        paths: ["C:\\notes.txt"],
        destinationDir: "C:\\",
      }));
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
      expect(invoke).toHaveBeenCalledWith("import_paths", expect.objectContaining({
        paths: ["C:\\notes.txt"],
        destinationDir: "C:\\Users",
      }));
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
      expect(invoke).toHaveBeenCalledWith("import_paths", expect.objectContaining({
        paths: ["C:\\notes.txt"],
        destinationDir: "C:\\Users",
      }));
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
      expect(invoke).toHaveBeenCalledWith("import_paths", expect.objectContaining({
        paths: ["C:\\draft.md"],
        destinationDir: "C:\\",
      }));
    });
    await flushPromises();
  });

  it("copies only the shown items once the folder holding a selected item is closed", async () => {
    renderFilesystemPanel({
      paneId: "pane-copy-closed-folder",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0, expandedPaths: ["C:\\Users"] },
    });
    fireEvent.click(await screen.findByRole("button", { name: /todo\.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /draft\.md/i }), { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: /Users/i }).querySelector("[data-entry-expander]"));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /todo\.txt/i })).not.toBeInTheDocument();
    });

    // App sends Ctrl+C with the pane's saved selection, which closing a folder leaves as it is.
    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
          commandId: "filesystem.copy",
          context: {
            source: "shortcut",
            targetPaneId: "pane-copy-closed-folder",
            selectedPaths: ["C:\\Users\\todo.txt", "C:\\draft.md"],
          },
        },
      }));
    });

    expect(invoke).toHaveBeenCalledWith("filesystem_clipboard_set", { paths: ["C:\\draft.md"], mode: "copy" });
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
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
        source: "C:\\notes.txt",
        destinationDir: "C:\\Users",
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

  it("sizes grid thumbnails to fill their cells, but keeps small icons at their size", async () => {
    let gridWidthPx = 600;
    // Only the grid itself reports this width; the panel around it is wider by its paddings.
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function getClientWidth() {
      return this.style.getPropertyValue("--grid-cols") ? gridWidthPx : gridWidthPx + 64;
    });
    function getLatestThumbnailSizeHint() {
      const latestCall = invoke.mock.calls.findLast(([command]) => command === "thumbnail_resolve_batch");
      return latestCall?.[1]?.request?.items?.[0]?.sizeHintPx;
    }
    const filesystemState = {
      currentDrive: "C:\\",
      currentPath: "C:\\Users",
      scrollTop: 0,
      viewType: "grid",
      thumbnailSizePx: 128,
    };
    const { unmount } = renderFilesystemPanel({ filesystemState });
    await screen.findByRole("button", { name: /todo\.txt/i });

    // 600 px minus 8 px padding each side holds 4 cells of at least 138 px (128 + padding and
    // border) with 8 px gaps; they share the rest and are 140 px wide.
    const grid = document.querySelector("[style*='--grid-cols']");
    expect(grid.style.getPropertyValue("--grid-cols")).toBe("4");
    expect(grid.style.getPropertyValue("--grid-preview-size")).toBe("130px");
    await waitFor(() => {
      expect(getLatestThumbnailSizeHint()).toBe(256);
    });
    unmount();

    // 7 cells of exactly 64 + 10 px: the previews are 64 px, yet still use the larger cached size,
    // as they do at any other width, so a resize doesn't swap cached sizes back and forth.
    gridWidthPx = 7 * 74 + 6 * 8 + 16;
    invoke.mockClear();
    const { unmount: unmountExactFit } = renderFilesystemPanel({
      filesystemState: { ...filesystemState, thumbnailSizePx: 64 },
    });
    await screen.findByRole("button", { name: /todo\.txt/i });
    expect(document.querySelector("[style*='--grid-cols']").style.getPropertyValue("--grid-preview-size")).toBe("64px");
    await waitFor(() => {
      expect(getLatestThumbnailSizeHint()).toBe(256);
    });
    unmountExactFit();

    // From 192 px up, previews can pass 256 px, so the 512 px cache is used.
    gridWidthPx = 600;
    invoke.mockClear();
    const { unmount: unmountLarge } = renderFilesystemPanel({
      filesystemState: { ...filesystemState, thumbnailSizePx: 192 },
    });
    await screen.findByRole("button", { name: /todo\.txt/i });
    await waitFor(() => {
      expect(getLatestThumbnailSizeHint()).toBe(512);
    });
    unmountLarge();

    renderFilesystemPanel({ filesystemState: { ...filesystemState, thumbnailSizePx: 48 } });
    await screen.findByRole("button", { name: /todo\.txt/i });
    expect(document.querySelector("[style*='--grid-cols']").style.getPropertyValue("--grid-preview-size")).toBe("48px");
  });

  it("lets grid cells be dragged and folders in the grid take drops", async () => {
    renderFilesystemPanel({
      tabId: "tab-grid",
      paneId: "pane-grid",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\Users",
        scrollTop: 0,
        viewType: "grid",
      },
    });

    const todoCell = await screen.findByRole("button", { name: /todo\.txt/i });
    const projectsCell = screen.getByRole("button", { name: /Projects/ });
    expect(screen.queryByText("Folder")).not.toBeInTheDocument();
    expect(todoCell).toHaveAttribute("data-drop-destination-path", "C:\\Users");
    expect(projectsCell).toHaveAttribute("data-drop-destination-path", "C:\\Users\\Projects");
    expect(useDraggable).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "filesystem-entry",
        sourcePath: "C:\\Users\\todo.txt",
        sourcePaneId: "pane-grid",
        dragPaths: ["C:\\Users\\todo.txt"],
      }),
    }));
    expect(useDroppable).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "entry", path: "C:\\Users\\Projects", paneId: "pane-grid" }),
    }));
  });

  it("middle-clicks grid cells like list rows", async () => {
    const onTabSelectedFilesChange = vi.fn();
    renderFilesystemPanel({
      tabId: "tab-1",
      onTabSelectedFilesChange,
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\",
        scrollTop: 0,
        viewType: "grid",
      },
    });

    const fileCell = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.mouseDown(fileCell, { button: 1 });
    fireEvent.mouseUp(fileCell, { button: 1 });
    expect(onTabSelectedFilesChange).toHaveBeenLastCalledWith(expect.objectContaining({
      selectedPaths: ["C:\\notes.txt"],
      previewOpenMode: "pinned",
    }));

    const folderCell = screen.getByRole("button", { name: /Temp/i });
    fireEvent.mouseDown(folderCell, { button: 1 });
    fireEvent.mouseUp(folderCell, { button: 1 });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("workspace_open_folder_from_tab", {
        payload: { tabId: "tab-1", path: "C:\\Temp" },
      });
    });
  });

  it("selects and deletes only the cells grid view shows, not what open folders hold", async () => {
    const onFilesystemStateChange = vi.fn();
    renderFilesystemPanel({
      tabId: "tab-grid-range",
      paneId: "pane-grid-range",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0, expandedPaths: ["C:\\Users"] },
      onFilesystemStateChange,
    });
    await screen.findByRole("button", { name: /todo\.txt/i });
    dispatchFilesystemCommand("filesystem.view.grid", "pane-grid-range");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /todo\.txt/i })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Users" }));
    fireEvent.click(screen.getByRole("button", { name: "draft.md" }), { shiftKey: true });
    const shownRange = ["C:\\Users", "C:\\Temp", "C:\\notes.txt", "C:\\draft.md"];
    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
        selectedPaths: shownRange,
      }));
    });

    dispatchFilesystemCommand("filesystem.deleteSelected", "pane-grid-range");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_paths", { paths: shownRange });
    });
    expect(openConfirmMock).toHaveBeenCalledWith(expect.objectContaining({
      message: "Delete 4 selected items permanently?",
    }));
  });

  it("drops the rename of an item created in a grid folder cell once the pane leaves the folder", async () => {
    renderFilesystemPanel({
      paneId: "pane-grid-create",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0, viewType: "grid" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Users" }));
    dispatchFilesystemCommand("filesystem.createFolder", "pane-grid-create");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_folder", { parentDir: "C:\\Users", name: "New folder" });
    });
    await flushPromises();
    // C:\Users\New folder is no cell here, so its rename waits.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    fireEvent.doubleClick(screen.getByRole("button", { name: "Temp" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Users" })).not.toBeInTheDocument();
    });
    dispatchFilesystemCommand("filesystem.navigateBack", "pane-grid-create");
    fireEvent.doubleClick(await screen.findByRole("button", { name: "Users" }));
    await screen.findByRole("button", { name: "todo.txt" });
    await flushPromises();

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("still renames an item created in a grid folder cell when the pane goes straight into that folder", async () => {
    renderFilesystemPanel({
      paneId: "pane-grid-create-enter",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0, viewType: "grid" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Users" }));
    dispatchFilesystemCommand("filesystem.createFolder", "pane-grid-create-enter");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_folder", { parentDir: "C:\\Users", name: "New folder" });
    });
    await flushPromises();

    fireEvent.doubleClick(screen.getByRole("button", { name: "Users" }));

    expect(await screen.findByRole("textbox")).toHaveValue("New folder");
  });

  it("marks workspace folders among the cells grid view shows, not the rows the folder tree would", async () => {
    const usersEntries = Array.from({ length: 12 }, (_, index) => ({
      name: `user-${index}`,
      path: `C:\\Users\\user-${index}`,
      is_dir: true,
    }));
    const rootEntries = [
      { name: "Users", path: "C:\\Users", is_dir: true },
      { name: "Workspace", path: "C:\\Workspace", is_dir: true },
      ...Array.from({ length: 200 }, (_, index) => ({
        name: `file-${index}.txt`,
        path: `C:\\file-${index}.txt`,
        is_dir: false,
      })),
    ];
    const baseInvoke = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_directory_page" && payload?.path === "C:\\") {
        const entries = rootEntries.slice(payload.offset, payload.offset + payload.limit);
        const hasMore = payload.offset + entries.length < rootEntries.length;
        return { entries, hasMore, totalCount: rootEntries.length };
      }
      if (command === "list_directory" && payload?.path === "C:\\Users") return usersEntries;
      if (command === "filesystem_resolve_workspace_folders")
        return Object.fromEntries(payload.paths.map((path) => [path, path === "C:\\Workspace"]));
      return baseInvoke(command, payload);
    });
    renderFilesystemPanel({
      paneId: "pane-grid-workspace",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0, expandedPaths: ["C:\\Users"] },
    });
    // The rows of the opened Users push Workspace out of the long list's rendered window.
    await screen.findByRole("button", { name: /user-0/i });
    expect(screen.queryByRole("button", { name: /Workspace/i })).not.toBeInTheDocument();

    dispatchFilesystemCommand("filesystem.view.grid", "pane-grid-workspace");

    const workspaceCell = await screen.findByRole("button", { name: "Workspace" });
    await waitFor(() => {
      expect(workspaceCell.className).toMatch(/cellConfig/);
    });
  });

  it("shows sortable detail columns and re-lists the folder when a column header is clicked", async () => {
    const onFilesystemStateChange = vi.fn();
    renderFilesystemPanel({
      tabId: "tab-details",
      paneId: "pane-details",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\Users",
        scrollTop: 0,
        viewType: "details",
      },
      onFilesystemStateChange,
    });

    const todoButton = await screen.findByRole("button", { name: /todo\.txt/i });
    expect(within(todoButton).getByText("TXT file")).toBeInTheDocument();
    const header = screen.getByTestId("filesystem-details-header");
    expect(within(header).getByRole("button", { name: /Name/ })).toHaveTextContent("▴");

    fireEvent.click(within(header).getByRole("button", { name: /Size/ }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_directory_page", expect.objectContaining({
        path: "C:\\Users",
        sortKey: "size",
        sortDescending: true,
        refresh: false,
      }));
    });
    expect(invoke).toHaveBeenCalledWith("workspace_folder_view_styles_set", {
      path: "C:\\Users",
      style: {
        viewType: "details",
        thumbnailSizePx: 22,
        sortKey: "size",
        sortDescending: true,
      },
    });
    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
        sortKey: "size",
        sortDescending: true,
      }));
    });
  });

  it("sorts from the command palette without leaving the current view", async () => {
    renderFilesystemPanel({
      tabId: "tab-sort-command",
      paneId: "pane-sort-command",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\Users",
        scrollTop: 0,
      },
    });

    await screen.findByRole("button", { name: /todo\.txt/i });
    expect(screen.queryByTestId("filesystem-details-header")).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
          commandId: "filesystem.sort.modified",
          context: { targetPaneId: "pane-sort-command" },
        },
      }));
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_directory_page", expect.objectContaining({
        path: "C:\\Users",
        sortKey: "modified",
        sortDescending: true,
      }));
    });
  });

  function dispatchFilesystemCommand(commandId, paneId) {
    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: { commandId, context: { targetPaneId: paneId } },
      }));
    });
  }

  it("keeps a selection inside an opened folder when the current folder is listed again", async () => {
    const onFilesystemStateChange = vi.fn();
    renderFilesystemPanel({
      tabId: "tab-nested-selection",
      paneId: "pane-nested-selection",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0, expandedPaths: ["C:\\Users"] },
      onFilesystemStateChange,
    });
    fireEvent.click(await screen.findByRole("button", { name: /todo\.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /draft\.md/i }), { ctrlKey: true });
    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
        selectedPaths: ["C:\\Users\\todo.txt", "C:\\draft.md"],
      }));
    });

    // Another program deletes draft.md, then reversing the sort lists C:\ again.
    const baseInvoke = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => {
      const result = await baseInvoke(command, payload);
      if (command !== "list_directory_page" || payload?.path !== "C:\\") return result;
      const entries = result.entries.filter((entry) => entry.name !== "draft.md");
      return { ...result, entries, totalCount: entries.length };
    });
    dispatchFilesystemCommand("filesystem.sort.reverse", "pane-nested-selection");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /draft\.md/i })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
        selectedPaths: ["C:\\Users\\todo.txt"],
      }));
    });
    expect(screen.getByRole("button", { name: /todo\.txt/i })).toHaveAttribute("aria-selected", "true");
  });

  it("filters the current folder by name and restores it on Escape", async () => {
    renderFilesystemPanel({
      tabId: "tab-filter",
      paneId: "pane-filter",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    await screen.findByRole("button", { name: /notes\.txt/i });

    dispatchFilesystemCommand("filesystem.filterCurrentFolder", "pane-filter");
    const filterInput = await screen.findByRole("searchbox", { name: "Filter current folder" });
    expect(filterInput).toHaveFocus();

    fireEvent.change(filterInput, { target: { value: "NOTES" } });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /draft\.md/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("list_directory_page", expect.objectContaining({
      path: "C:\\",
      filter: "NOTES",
      refresh: false,
    }));

    fireEvent.keyDown(filterInput, { key: "Escape" });

    expect(screen.queryByRole("searchbox", { name: "Filter current folder" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /draft\.md/i })).toBeInTheDocument();
  });

  it("selects the first match on Enter and says when nothing matches", async () => {
    renderFilesystemPanel({
      tabId: "tab-filter-enter",
      paneId: "pane-filter-enter",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    await screen.findByRole("button", { name: /notes\.txt/i });

    dispatchFilesystemCommand("filesystem.filterCurrentFolder", "pane-filter-enter");
    const filterInput = await screen.findByRole("searchbox", { name: "Filter current folder" });

    fireEvent.change(filterInput, { target: { value: "draft" } });
    const draftButton = await waitFor(() => {
      expect(screen.queryByRole("button", { name: /notes\.txt/i })).not.toBeInTheDocument();
      return screen.getByRole("button", { name: /draft\.md/i });
    });
    fireEvent.keyDown(filterInput, { key: "Enter" });
    expect(draftButton).toHaveAttribute("aria-selected", "true");

    fireEvent.change(filterInput, { target: { value: "zzz" } });
    expect(await screen.findByText('No items match "zzz".')).toBeInTheDocument();
  });

  it("clears the filter when navigating to another folder", async () => {
    renderFilesystemPanel({
      paneId: "pane-filter-nav",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    await screen.findByRole("button", { name: /notes\.txt/i });

    dispatchFilesystemCommand("filesystem.filterCurrentFolder", "pane-filter-nav");
    fireEvent.change(
      await screen.findByRole("searchbox", { name: "Filter current folder" }),
      { target: { value: "temp" } },
    );
    const tempButton = await waitFor(() => {
      expect(screen.queryByRole("button", { name: /notes\.txt/i })).not.toBeInTheDocument();
      return screen.getByRole("button", { name: /Temp/i });
    });

    fireEvent.doubleClick(tempButton);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_directory_page", expect.objectContaining({
        path: "C:\\Temp",
        filter: "",
      }));
    });
    expect(screen.queryByRole("searchbox", { name: "Filter current folder" })).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("list_directory_page", expect.objectContaining({
      path: "C:\\Temp",
      filter: "temp",
    }));
  });

  it("searches subfolders in the pane and returns to the folder listing on Escape", async () => {
    renderFilesystemPanel({
      paneId: "pane-search",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    await screen.findByRole("button", { name: /notes\.txt/i });

    dispatchFilesystemCommand("filesystem.searchCurrentSubtree", "pane-search");
    const searchInput = await screen.findByRole("searchbox", {
      name: "Search current folder and subfolders",
    });
    fireEvent.change(searchInput, { target: { value: "todo" } });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("filesystem_search_start", expect.objectContaining({
        root: "C:\\",
        query: "todo",
      }));
    });
    const [, { searchId }] = invoke.mock.calls.findLast(([command]) => command === "filesystem_search_start");
    await filesystemSearchCallback({
      payload: {
        searchId,
        entries: [{ name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false }],
        done: true,
        truncated: false,
      },
    });

    const resultButton = await screen.findByRole("button", { name: /todo\.txt/i });
    expect(within(resultButton).getByText("Users")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent('1 result for "todo"');
    expect(screen.queryByRole("button", { name: /notes\.txt/i })).not.toBeInTheDocument();

    fireEvent.keyDown(searchInput, { key: "Escape" });

    expect(await screen.findByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /todo\.txt/i })).not.toBeInTheDocument();
  });

  it("carries typed text over when switching from filter to search", async () => {
    renderFilesystemPanel({
      paneId: "pane-filter-to-search",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    await screen.findByRole("button", { name: /notes\.txt/i });

    dispatchFilesystemCommand("filesystem.filterCurrentFolder", "pane-filter-to-search");
    const filterInput = await screen.findByRole("searchbox", { name: "Filter current folder" });
    fireEvent.change(filterInput, { target: { value: "todo" } });
    fireEvent.keyDown(filterInput, { key: "f", ctrlKey: true, shiftKey: true });

    const searchInput = await screen.findByRole("searchbox", {
      name: "Search current folder and subfolders",
    });
    expect(searchInput).toHaveValue("todo");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("filesystem_search_start", expect.objectContaining({
        query: "todo",
      }));
    });
  });

  it("notes skipped folders when a search finds nothing and shows a refused regex in the status line", async () => {
    const baseInvoke = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "filesystem_search_start" && payload.options.useRegex) throw "Invalid regex: unclosed group";
      return baseInvoke(command, payload);
    });
    renderFilesystemPanel({
      paneId: "pane-search-status",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    await screen.findByRole("button", { name: /notes\.txt/i });

    dispatchFilesystemCommand("filesystem.searchCurrentSubtree", "pane-search-status");
    const searchInput = await screen.findByRole("searchbox", {
      name: "Search current folder and subfolders",
    });
    fireEvent.change(searchInput, { target: { value: "zzz" } });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("filesystem_search_start", expect.objectContaining({
        query: "zzz",
        options: expect.objectContaining({ useRegex: false, skipFolderNames: expect.arrayContaining(["node_modules"]) }),
      }));
    });
    const [, { searchId }] = invoke.mock.calls.findLast(([command]) => command === "filesystem_search_start");
    await filesystemSearchCallback({ payload: { searchId, entries: [], done: true, truncated: false } });
    expect(screen.getByRole("status")).toHaveTextContent(
      'No results for "zzz" in this folder or its subfolders (skipped folders not searched).',
    );

    fireEvent.change(searchInput, { target: { value: "a(" } });
    fireEvent.click(screen.getByRole("button", { name: "Use regular expression" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Invalid regex: unclosed group");
    });
  });

  it("restores search options from the pane state and saves changes to them", async () => {
    const onFilesystemStateChange = vi.fn();
    renderFilesystemPanel({
      tabId: "tab-search-options",
      paneId: "pane-search-options",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\",
        scrollTop: 0,
        searchOptions: { useRegex: true, skipFolders: false, skipFolderNames: ["dist"], skipCacheDirTagged: true },
      },
      onFilesystemStateChange,
    });
    await screen.findByRole("button", { name: /notes\.txt/i });

    dispatchFilesystemCommand("filesystem.searchCurrentSubtree", "pane-search-options");
    const searchInput = await screen.findByRole("searchbox", {
      name: "Search current folder and subfolders",
    });
    const regexToggle = screen.getByRole("button", { name: "Use regular expression" });
    expect(regexToggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(searchInput, { target: { value: "^notes" } });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("filesystem_search_start", expect.objectContaining({
        query: "^notes",
        options: { useRegex: true, skipFolderNames: [], skipCacheDirTagged: true, skipHidden: false },
      }));
    });

    fireEvent.click(regexToggle);

    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
        searchOptions: { useRegex: false, skipFolders: false, skipFolderNames: ["dist"], skipCacheDirTagged: true },
      }));
    });
    await waitFor(() => {
      const [, lastStart] = invoke.mock.calls.findLast(([command]) => command === "filesystem_search_start");
      expect(lastStart).toEqual(expect.objectContaining({
        query: "^notes",
        options: { useRegex: false, skipFolderNames: [], skipCacheDirTagged: true, skipHidden: false },
      }));
    });
  });

  it("saves default search options as null, so untouched panes keep no copy of the defaults", async () => {
    const onFilesystemStateChange = vi.fn();
    renderFilesystemPanel({
      tabId: "tab-default-search-options",
      paneId: "pane-default-search-options",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
      onFilesystemStateChange,
    });
    fireEvent.click(await screen.findByRole("button", { name: /notes\.txt/i }));
    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
        selectedPaths: ["C:\\notes.txt"],
        searchOptions: null,
      }));
    });

    dispatchFilesystemCommand("filesystem.searchCurrentSubtree", "pane-default-search-options");
    const regexToggle = await screen.findByRole("button", { name: "Use regular expression" });
    fireEvent.click(regexToggle);
    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
        searchOptions: expect.objectContaining({ useRegex: true }),
      }));
    });

    fireEvent.click(regexToggle);
    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ searchOptions: null }));
    });
  });

  it("leaves Enter and arrow keys on header controls and in the search options to those controls", async () => {
    renderFilesystemPanel({
      paneId: "pane-header-keys",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    const tempButton = await screen.findByRole("button", { name: /Temp/i });
    fireEvent.click(tempButton);
    expect(tempButton).toHaveAttribute("aria-selected", "true");

    const sizeToggle = screen.getByRole("button", { name: /Toggle icon and thumbnail size/ });
    fireEvent.keyDown(sizeToggle, { key: "Enter" });
    fireEvent.keyDown(sizeToggle, { key: "ArrowDown" });

    dispatchFilesystemCommand("filesystem.searchCurrentSubtree", "pane-header-keys");
    await screen.findByRole("searchbox", { name: "Search current folder and subfolders" });
    fireEvent.click(screen.getByRole("button", { name: "Search options" }));
    const optionsPanel = screen.getByRole("group", { name: "Search options" });
    fireEvent.keyDown(optionsPanel, { key: "Enter" });
    fireEvent.keyDown(optionsPanel, { key: "ArrowDown" });
    await flushPromises();

    expect(invoke).not.toHaveBeenCalledWith("list_directory_page", expect.objectContaining({ path: "C:\\Temp" }));
    expect(tempButton).toHaveAttribute("aria-selected", "true");
  });

  it("does not let Enter on one pane's header open the selection of the pane under the pointer", async () => {
    render(
      <PanelsDndLayer>
        <div data-pane-active="false" data-testid="pane-a">
          <FilesystemPanel tabId="tab-header-keys" paneId="pane-a" />
        </div>
        <div data-pane-active="true" data-testid="pane-b">
          <FilesystemPanel tabId="tab-header-keys" paneId="pane-b" />
        </div>
      </PanelsDndLayer>,
    );
    const paneA = within(screen.getByTestId("pane-a"));
    const paneB = within(screen.getByTestId("pane-b"));
    fireEvent.doubleClick(await paneB.findByRole("button", { name: /C:\\/i }));
    fireEvent.click(await paneB.findByRole("button", { name: /Users/i }));

    const callsBefore = invoke.mock.calls.length;

    fireEvent.keyDown(paneA.getByRole("button", { name: /Toggle icon and thumbnail size/ }), { key: "Enter" });
    await flushPromises();

    const openCalls = invoke.mock.calls.slice(callsBefore)
      .map(([command]) => command)
      .filter((command) => command.startsWith("workspace_open") || command === "list_directory_page");
    expect(openCalls).toEqual([]);
  });

  it("leaves keys the focused list does nothing with to that list, not to the pane under the pointer", async () => {
    const filesystemState = { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 };
    render(
      <PanelsDndLayer>
        <div data-pane-active="false" data-testid="pane-a">
          <FilesystemPanel tabId="tab-list-keys" paneId="pane-a" filesystemState={filesystemState} />
        </div>
        <div data-pane-active="true" data-testid="pane-b">
          <FilesystemPanel tabId="tab-list-keys" paneId="pane-b" filesystemState={filesystemState} />
        </div>
      </PanelsDndLayer>,
    );
    const paneA = within(screen.getByTestId("pane-a"));
    const paneB = within(screen.getByTestId("pane-b"));
    const usersInB = await paneB.findByRole("button", { name: /Users/i });
    fireEvent.click(usersInB);
    const notesInA = await paneA.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesInA);
    notesInA.focus();
    const callsBefore = invoke.mock.calls.length;

    // Right on a file, then Delete and Enter with nothing selected, do nothing in A.
    fireEvent.keyDown(notesInA, { key: "ArrowRight" });
    fireEvent.click(notesInA, { ctrlKey: true });
    fireEvent.keyDown(notesInA, { key: "Delete" });
    fireEvent.keyDown(notesInA, { key: "Enter" });
    await flushPromises();

    expect(openConfirmMock).not.toHaveBeenCalled();
    const listingAndOpenCalls = invoke.mock.calls.slice(callsBefore)
      .map(([command]) => command)
      .filter((command) => command.startsWith("list_directory") || command.startsWith("workspace_open"));
    expect(listingAndOpenCalls).toEqual([]);
    expect(usersInB).toHaveAttribute("aria-selected", "true");

    // With nothing focused, keys go to the pane under the pointer.
    notesInA.blur();
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(paneB.getByRole("button", { name: /Temp/i })).toHaveAttribute("aria-selected", "true");
  });

  // Pane A at C:\ and pane B, under the pointer, at C:\Users.
  function renderPanesWithPointerOverB(tabId) {
    render(
      <PanelsDndLayer>
        <div data-pane-active="false" data-testid="pane-a">
          <FilesystemPanel
            tabId={tabId}
            paneId="pane-a"
            filesystemState={{ currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 }}
          />
        </div>
        <div data-pane-active="true" data-testid="pane-b">
          <FilesystemPanel
            tabId={tabId}
            paneId="pane-b"
            filesystemState={{ currentDrive: "C:\\", currentPath: "C:\\Users", scrollTop: 0 }}
          />
        </div>
      </PanelsDndLayer>,
    );
    return { paneA: within(screen.getByTestId("pane-a")), paneB: within(screen.getByTestId("pane-b")) };
  }

  async function commitRename(pane, newName) {
    const renameInput = await pane.findByRole("textbox");
    fireEvent.change(renameInput, { target: { value: newName } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    await waitFor(() => {
      expect(pane.queryByRole("textbox")).not.toBeInTheDocument();
    });
  }

  // The renames undo and redo ran (they may not adjust the name) from the call at `fromCallIndex`.
  function getUndoAndRedoRenames(fromCallIndex) {
    return invoke.mock.calls.slice(fromCallIndex)
      .filter(([command, payload]) => command === "rename_path" && payload.allowAdjustment === false)
      .map(([, payload]) => `${payload.path} -> ${payload.newName}`);
  }

  it("renames, undoes and redoes in the pane under the pointer, also while another pane's list has focus", async () => {
    const { paneA, paneB } = renderPanesWithPointerOverB("tab-shortcut-keys");
    // Each pane gets a rename to undo: B from F2 on its list, A from the menu.
    const todoInB = await paneB.findByRole("button", { name: /todo\.txt/i });
    fireEvent.click(todoInB);
    todoInB.focus();
    fireEvent.keyDown(todoInB, { key: "F2" });
    await commitRename(paneB, "todo2.txt");
    fireEvent.click(await paneA.findByRole("button", { name: /notes\.txt/i }));
    dispatchFilesystemCommand("filesystem.renameSelected", "pane-a");
    await commitRename(paneA, "renamed.txt");
    // A's list has focus, on a file selected there, which F2 would rename.
    const renamedInA = await paneA.findByRole("button", { name: /renamed\.txt/i });
    fireEvent.click(renamedInA);
    renamedInA.focus();
    const callsBefore = invoke.mock.calls.length;

    fireEvent.keyDown(renamedInA, { key: "z", ctrlKey: true });
    expect(await paneB.findByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
    fireEvent.keyDown(renamedInA, { key: "y", ctrlKey: true });
    expect(await paneB.findByRole("button", { name: /todo2\.txt/i })).toBeInTheDocument();
    fireEvent.click(paneB.getByRole("button", { name: /Projects/i }));
    renamedInA.focus();
    fireEvent.keyDown(renamedInA, { key: "F2" });

    expect(await paneB.findByRole("textbox")).toHaveValue("Projects");
    expect(paneA.queryByRole("textbox")).not.toBeInTheDocument();
    expect(getUndoAndRedoRenames(callsBefore)).toEqual([
      "C:\\Users\\todo2.txt -> todo.txt",
      "C:\\Users\\todo.txt -> todo2.txt",
    ]);

    // With nothing focused, the keys go there as well.
    fireEvent.keyDown(paneB.getByRole("textbox"), { key: "Escape" });
    act(() => document.activeElement.blur());
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(await paneB.findByRole("button", { name: /todo\.txt/i })).toBeInTheDocument();
    expect(getUndoAndRedoRenames(callsBefore).at(-1)).toBe("C:\\Users\\todo2.txt -> todo.txt");
    expect(paneA.getByRole("button", { name: /renamed\.txt/i })).toBeInTheDocument();
  });

  // As App's shortcut listener does: F2, Ctrl+Z and Ctrl+Y (or Ctrl+Shift+Z) go to the active pane,
  // the one under the pointer.
  function sendShortcutToPaneB(event) {
    const commandId = [COMMAND_IDS.FILESYSTEM_RENAME_SELECTED, COMMAND_IDS.FILESYSTEM_UNDO, COMMAND_IDS.FILESYSTEM_REDO]
      .find((id) => isCommandShortcutMatch(id, event));
    if (event.defaultPrevented || !commandId) return;
    event.preventDefault();
    executeCommand(commandId, { context: { source: "shortcut", activePaneId: "pane-b" } });
  }

  it.each(["before", "after"])("acts on F2, Ctrl+Z and Ctrl+Y once, in the pane under the pointer, with the app's shortcut listener %s the panes' own", async (appListenerTurn) => {
    // The window runs its listeners in the order they were added. The panes add theirs again
    // whenever what they act on changes, so to run after them the app's is added again before
    // each key.
    const pressKey = (element, keyOptions) => {
      if (appListenerTurn === "after") {
        window.removeEventListener("keydown", sendShortcutToPaneB);
        window.addEventListener("keydown", sendShortcutToPaneB);
      }
      fireEvent.keyDown(element, keyOptions);
    };
    const renameCommandPaneIds = [];
    const recordRenameCommand = ({ detail: { commandId, context } }) => {
      if (commandId !== COMMAND_IDS.FILESYSTEM_RENAME_SELECTED) return;
      renameCommandPaneIds.push(context.targetPaneId || context.activePaneId);
    };
    if (appListenerTurn === "before") window.addEventListener("keydown", sendShortcutToPaneB);
    window.addEventListener(APP_COMMAND_EVENT, recordRenameCommand);
    try {
      const { paneA, paneB } = renderPanesWithPointerOverB("tab-app-shortcuts");
      // Two renames in B: a key acting twice would undo or redo both.
      for (const [name, newName] of [[/todo\.txt/i, "todo2.txt"], [/Projects/i, "Projects2"]]) {
        const button = await paneB.findByRole("button", { name });
        fireEvent.click(button);
        button.focus();
        pressKey(button, { key: "F2" });
        await commitRename(paneB, newName);
      }
      const notesInA = await paneA.findByRole("button", { name: /notes\.txt/i });
      fireEvent.click(notesInA);
      notesInA.focus();
      const callsBefore = invoke.mock.calls.length;

      const expectedRenames = [];
      for (const [keyOptions, rename] of [
        [{ key: "z", ctrlKey: true }, "C:\\Users\\Projects2 -> Projects"],
        [{ key: "z", ctrlKey: true }, "C:\\Users\\todo2.txt -> todo.txt"],
        [{ key: "y", ctrlKey: true }, "C:\\Users\\todo.txt -> todo2.txt"],
        [{ key: "z", ctrlKey: true, shiftKey: true }, "C:\\Users\\Projects -> Projects2"],
      ]) {
        pressKey(notesInA, keyOptions);
        expectedRenames.push(rename);
        await waitFor(() => {
          expect(paneB.queryByText("Moving item...")).not.toBeInTheDocument();
        });
        expect(getUndoAndRedoRenames(callsBefore)).toEqual(expectedRenames);
      }

      renameCommandPaneIds.length = 0;
      fireEvent.click(paneB.getByRole("button", { name: /todo2\.txt/i }));
      notesInA.focus();
      pressKey(notesInA, { key: "F2" });
      expect(await paneB.findByRole("textbox")).toHaveValue("todo2.txt");
      expect(paneA.queryByRole("textbox")).not.toBeInTheDocument();
      expect(renameCommandPaneIds).toEqual(["pane-b"]);
    } finally {
      window.removeEventListener("keydown", sendShortcutToPaneB);
      window.removeEventListener(APP_COMMAND_EVENT, recordRenameCommand);
    }
  });

  it("leaves F2, Ctrl+Z and Ctrl+Y in a rename box, the filter box and the path editor to that field", async () => {
    renderFilesystemPanel({
      paneId: "pane-field-keys",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    // A rename first, so the pane has something Ctrl+Z would undo.
    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);
    notesButton.focus();
    fireEvent.keyDown(notesButton, { key: "F2" });
    const notesRenameInput = await screen.findByRole("textbox");
    fireEvent.change(notesRenameInput, { target: { value: "renamed.txt" } });
    fireEvent.keyDown(notesRenameInput, { key: "Enter" });
    await screen.findByRole("button", { name: /renamed\.txt/i });
    const callsBefore = invoke.mock.calls.length;
    const pressShortcutKeys = (field) => {
      [{ key: "z", ctrlKey: true }, { key: "y", ctrlKey: true }, { key: "F2" }].forEach((keyOptions) => {
        const event = createEvent.keyDown(field, keyOptions);
        fireEvent(field, event);
        expect(event.defaultPrevented).toBe(false);
      });
    };

    const draftButton = screen.getByRole("button", { name: /draft\.md/i });
    fireEvent.click(draftButton);
    draftButton.focus();
    fireEvent.keyDown(draftButton, { key: "F2" });
    const renameInput = await screen.findByRole("textbox");
    pressShortcutKeys(renameInput);
    await flushPromises();
    expect(screen.getByRole("textbox")).toBe(renameInput);
    fireEvent.keyDown(renameInput, { key: "Escape" });

    dispatchFilesystemCommand("filesystem.filterCurrentFolder", "pane-field-keys");
    pressShortcutKeys(await screen.findByRole("searchbox", { name: "Filter current folder" }));
    await flushPromises();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    dispatchFilesystemCommand("filesystem.focusBreadcrumbInput", "pane-field-keys");
    const pathInput = await screen.findByRole("textbox", { name: "Current folder path" });
    pressShortcutKeys(pathInput);
    await flushPromises();
    expect(screen.getByRole("textbox")).toBe(pathInput);

    const undoAndRedoCalls = invoke.mock.calls.slice(callsBefore)
      .filter(([command, payload]) => command === "rename_path" && payload.allowAdjustment === false);
    expect(undoAndRedoCalls).toEqual([]);
  });

  it("starts one rename for a held F2", async () => {
    renderFilesystemPanel({
      paneId: "pane-held-f2",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);
    notesButton.focus();
    fireEvent.keyDown(notesButton, { key: "F2" });
    const renameInput = await screen.findByRole("textbox");

    // F2 is still down when a click on draft.md ends the rename (its box loses focus), and the
    // key goes on repeating there.
    fireEvent.blur(renameInput);
    await waitFor(() => {
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
    const draftButton = screen.getByRole("button", { name: /draft\.md/i });
    fireEvent.click(draftButton);
    draftButton.focus();
    fireEvent.keyDown(draftButton, { key: "F2", repeat: true });
    await flushPromises();

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("leaves F2 and Ctrl+Z alone while a move in the pane runs", async () => {
    const moveGate = Promise.withResolvers();
    const baseInvoke = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "move_path") await moveGate.promise;
      return baseInvoke(command, payload);
    });
    renderFilesystemPanel({
      paneId: "pane-busy-keys",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
    });
    // A rename first, so Ctrl+Z has something to undo.
    const notesButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(notesButton);
    notesButton.focus();
    fireEvent.keyDown(notesButton, { key: "F2" });
    await commitRename(screen, "renamed.txt");
    await waitFor(() => {
      expect(screen.queryByText("Moving item...")).not.toBeInTheDocument();
    });

    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\draft.md" } });
    await dndCallbacks.onDragEnd?.({ active: { id: "entry:C:\\draft.md" }, over: { id: "entry:C:\\Users" } });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({ source: "C:\\draft.md" }));
    });
    const callsBefore = invoke.mock.calls.length;
    const renamedButton = screen.getByRole("button", { name: /renamed\.txt/i });
    fireEvent.click(renamedButton);
    renamedButton.focus();
    fireEvent.keyDown(renamedButton, { key: "F2" });
    fireEvent.keyDown(renamedButton, { key: "z", ctrlKey: true });
    await flushPromises();

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(getUndoAndRedoRenames(callsBefore)).toEqual([]);

    // Once the move is done, F2 renames again.
    await act(async () => {
      moveGate.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByText(/^Moving/)).not.toBeInTheDocument();
    });
    const renamedButtonAfterMove = screen.getByRole("button", { name: /renamed\.txt/i });
    renamedButtonAfterMove.focus();
    fireEvent.keyDown(renamedButtonAfterMove, { key: "F2" });
    expect(await screen.findByRole("textbox")).toHaveValue("renamed.txt");
  });

  it("lets go of focus when a header button is clicked, so keys go to the pane under the pointer", async () => {
    const filesystemState = { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 };
    render(
      <PanelsDndLayer>
        <div data-pane-active="false" data-testid="pane-a">
          <FilesystemPanel tabId="tab-header-focus" paneId="pane-a" filesystemState={filesystemState} />
        </div>
        <div data-pane-active="true" data-testid="pane-b">
          <FilesystemPanel tabId="tab-header-focus" paneId="pane-b" filesystemState={filesystemState} />
        </div>
      </PanelsDndLayer>,
    );
    const paneA = within(screen.getByTestId("pane-a"));
    const paneB = within(screen.getByTestId("pane-b"));
    (await paneA.findByRole("button", { name: /Users/i })).focus();
    const sizeToggleInB = paneB.getByRole("button", { name: /Toggle icon and thumbnail size/ });

    fireEvent.mouseDown(sizeToggleInB);
    expect(document.activeElement).toBe(document.body);

    dispatchFilesystemCommand("filesystem.focusBreadcrumbInput", "pane-b");
    expect(await paneB.findByRole("textbox", { name: "Current folder path" })).toHaveFocus();
    fireEvent.mouseDown(sizeToggleInB);
    expect(paneB.queryByRole("textbox", { name: "Current folder path" })).not.toBeInTheDocument();
  });

  async function showSearchResults(paneId, query, entries) {
    dispatchFilesystemCommand("filesystem.searchCurrentSubtree", paneId);
    fireEvent.change(
      await screen.findByRole("searchbox", { name: "Search current folder and subfolders" }),
      { target: { value: query } },
    );
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("filesystem_search_start", expect.objectContaining({ query }));
    });
    const [, { searchId }] = invoke.mock.calls.findLast(([command]) => command === "filesystem_search_start");
    await filesystemSearchCallback({ payload: { searchId, entries, done: true, truncated: false } });
  }

  it("clears the selection when the search options change during a search", async () => {
    const onFilesystemStateChange = vi.fn();
    renderFilesystemPanel({
      tabId: "tab-search-options-selection",
      paneId: "pane-search-options-selection",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
      onFilesystemStateChange,
    });
    await screen.findByRole("button", { name: /notes\.txt/i });
    await showSearchResults("pane-search-options-selection", "notes", [
      { name: "notes.txt", path: "C:\\notes.txt", is_dir: false },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /notes\.txt/i }));
    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
        selectedPaths: ["C:\\notes.txt"],
      }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Use regular expression" }));

    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ selectedPaths: [] }));
    });
  });

  function mockHiddenEntries() {
    const hiddenFixture = {
      "C:\\": [
        { name: "Users", path: "C:\\Users", is_dir: true, is_hidden: false },
        { name: "$Recycle.Bin", path: "C:\\$Recycle.Bin", is_dir: true, is_hidden: true },
        { name: "notes.txt", path: "C:\\notes.txt", is_dir: false, is_hidden: false },
        { name: "pagefile.sys", path: "C:\\pagefile.sys", is_dir: false, is_hidden: true },
      ],
      "C:\\Users": [
        { name: "Projects", path: "C:\\Users\\Projects", is_dir: true, is_hidden: false },
        { name: "AppData", path: "C:\\Users\\AppData", is_dir: true, is_hidden: true },
      ],
    };
    const baseInvoke = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => {
      const folderEntries = hiddenFixture[payload?.path];
      if (command === "list_directory_page" && folderEntries) {
        const entries = folderEntries.filter((entry) => payload.showHidden !== false || !entry.is_hidden);
        return { entries, hasMore: false, totalCount: entries.length };
      }
      if (command === "list_directory" && folderEntries) return folderEntries;
      return baseInvoke(command, payload);
    });
  }

  // Returns a setter that rerenders the panel with another hidden-files preference.
  function renderHiddenEntriesPanel(showHiddenFiles) {
    const props = {
      paneId: "pane-hidden",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0, expandedPaths: ["C:\\Users"] },
    };
    const view = renderFilesystemPanel({ ...props, showHiddenFiles });
    return (nextShowHiddenFiles) => view.rerender(<PanelsDndLayer>
      <FilesystemPanel {...props} showHiddenFiles={nextShowHiddenFiles} />
    </PanelsDndLayer>);
  }

  it("dims hidden entries when shown and drops them from the listing and expanded folders when hidden", async () => {
    mockHiddenEntries();
    const setShowHiddenFiles = renderHiddenEntriesPanel(true);

    const pagefileButton = await screen.findByRole("button", { name: /pagefile\.sys/i });
    expect(pagefileButton.className).toMatch(/hiddenEntry/);
    expect(await screen.findByRole("button", { name: /AppData/i })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("list_directory_page", expect.objectContaining({
      path: "C:\\",
      showHidden: true,
    }));

    setShowHiddenFiles(false);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /pagefile\.sys/i })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /Recycle\.Bin/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /AppData/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Projects/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /notes\.txt/i })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("list_directory_page", expect.objectContaining({
      path: "C:\\",
      showHidden: false,
      refresh: false,
    }));

    setShowHiddenFiles(true);

    expect(await screen.findByRole("button", { name: /pagefile\.sys/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /AppData/i })).toBeInTheDocument();
  });

  it("drops a selected hidden entry from the selection once hidden files are hidden", async () => {
    mockHiddenEntries();
    const setShowHiddenFiles = renderHiddenEntriesPanel(true);
    const pagefileButton = await screen.findByRole("button", { name: /pagefile\.sys/i });
    fireEvent.click(pagefileButton);
    expect(pagefileButton).toHaveAttribute("aria-selected", "true");

    setShowHiddenFiles(false);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /pagefile\.sys/i })).not.toBeInTheDocument();
    });
    dispatchFilesystemCommand("filesystem.deleteSelected", "pane-hidden");
    await flushPromises();

    expect(openConfirmMock).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("delete_paths", expect.anything());
  });

  it("cuts only the shown items once a selected item in an opened folder is hidden", async () => {
    mockHiddenEntries();
    const setShowHiddenFiles = renderHiddenEntriesPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: /AppData/i }));
    fireEvent.click(screen.getByRole("button", { name: /notes\.txt/i }), { ctrlKey: true });

    setShowHiddenFiles(false);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /AppData/i })).not.toBeInTheDocument();
    });
    // App sends Ctrl+X with the pane's saved selection, which still holds AppData: listing C:\ again
    // only drops what C:\ itself no longer lists.
    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
          commandId: "filesystem.cut",
          context: {
            source: "shortcut",
            targetPaneId: "pane-hidden",
            selectedPaths: ["C:\\Users\\AppData", "C:\\notes.txt"],
          },
        },
      }));
    });

    expect(invoke).toHaveBeenCalledWith("filesystem_clipboard_set", { paths: ["C:\\notes.txt"], mode: "cut" });
  });

  it("leaves hidden folders out of path suggestions when hidden files are hidden", async () => {
    mockHiddenEntries();
    const setShowHiddenFiles = renderHiddenEntriesPanel(true);
    await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(screen.getByRole("navigation", { name: "Current path" }));
    const pathInput = await screen.findByRole("textbox", { name: "Current folder path" });
    act(() => pathInput.focus());

    // The draft starts as the current path, so a different spelling is needed to trigger a change.
    fireEvent.change(pathInput, { target: { value: "C:/" } });
    expect(await screen.findByRole("button", { name: /C:\\\$Recycle\.Bin/i })).toBeInTheDocument();

    setShowHiddenFiles(false);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /C:\\\$Recycle\.Bin/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /C:\\Users/i })).toBeInTheDocument();
  });

  it("searches without hidden entries once hidden files are hidden", async () => {
    mockHiddenEntries();
    renderHiddenEntriesPanel(false);
    await screen.findByRole("button", { name: /notes\.txt/i });

    dispatchFilesystemCommand("filesystem.searchCurrentSubtree", "pane-hidden");
    fireEvent.change(
      await screen.findByRole("searchbox", { name: "Search current folder and subfolders" }),
      { target: { value: "notes" } },
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("filesystem_search_start", expect.objectContaining({
        query: "notes",
        options: expect.objectContaining({ skipHidden: true }),
      }));
    });
  });

  it("clears a search selection holding a hidden entry once hidden files are hidden", async () => {
    mockHiddenEntries();
    const onFilesystemStateChange = vi.fn();
    const props = {
      tabId: "tab-hidden-search",
      paneId: "pane-hidden-search",
      filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
      onFilesystemStateChange,
    };
    const view = renderFilesystemPanel({ ...props, showHiddenFiles: true });
    await screen.findByRole("button", { name: /notes\.txt/i });
    await showSearchResults("pane-hidden-search", "s", [
      { name: "notes.txt", path: "C:\\notes.txt", is_dir: false, is_hidden: false },
      { name: "pagefile.sys", path: "C:\\pagefile.sys", is_dir: false, is_hidden: true },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /notes\.txt/i }));
    fireEvent.click(screen.getByRole("button", { name: /pagefile\.sys/i }), { shiftKey: true });
    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
        selectedPaths: ["C:\\notes.txt", "C:\\pagefile.sys"],
      }));
    });

    view.rerender(<PanelsDndLayer>
      <FilesystemPanel {...props} showHiddenFiles={false} />
    </PanelsDndLayer>);

    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ selectedPaths: [] }));
    });
  });

  it("renames the item the Windows menu was opened on, not the earlier selection", async () => {
    renderFilesystemPanel({ paneId: "pane-shell-menu" });
    const baseInvoke = invoke.getMockImplementation();
    invoke.mockImplementation(async (command, payload) => (
      command === "filesystem_show_shell_menu" ? "rename" : baseInvoke(command, payload)
    ));

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);
    fireEvent.click(await screen.findByRole("button", { name: /draft\.md/i }));

    act(() => {
      window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
        detail: {
          commandId: "filesystem.showShellMenu",
          context: {
            source: "context-menu",
            targetPaneId: "pane-shell-menu",
            targetType: "file",
            targetScope: "tree-entry",
            targetPath: "C:\\notes.txt",
            selectedPaths: ["C:\\notes.txt"],
            pointerX: 12,
            pointerY: 34,
          },
        },
      }));
    });

    expect(invoke).toHaveBeenCalledWith("filesystem_show_shell_menu", {
      target: { kind: "items", paths: ["C:\\notes.txt"] },
      x: 12,
      y: 34,
      extended: false,
    });
    expect(await screen.findByRole("textbox")).toHaveValue("notes.txt");
  });

  describe("foldable grid", () => {
    // Only the foldable grid reports this width; the panel around it is wider by its paddings.
    let foldableGridWidthPx;

    beforeEach(() => {
      foldableGridWidthPx = 600;
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function getClientWidth() {
        return this.dataset.testid === "filesystem-foldable-grid" ? foldableGridWidthPx : foldableGridWidthPx + 64;
      });
    });

    function renderFoldableGrid(filesystemState = {}, props = {}) {
      return renderFilesystemPanel({
        tabId: "tab-foldable",
        paneId: "pane-foldable",
        ...props,
        filesystemState: {
          currentDrive: "C:\\",
          currentPath: "C:\\",
          scrollTop: 0,
          viewType: "foldable-grid",
          ...filesystemState,
        },
      });
    }

    // The entries the foldable grid shows, in reading order.
    function getShownPaths() {
      return Array.from(screen.getByTestId("filesystem-foldable-grid").querySelectorAll("[data-context-id]"))
        .map((element) => element.dataset.contextId);
    }

    // The block a tile is drawn in: all the lines of its folder's files between two folder rows.
    function getTileRun(tile) {
      return tile.closest("[style*='--line-cols']");
    }

    // The sizes a tile gets from its run, as its styles read them.
    function getTileSizes(tile) {
      const style = getComputedStyle(tile);
      const readPx = (name) => Number.parseFloat(style.getPropertyValue(name));
      return {
        columnCount: Number(style.getPropertyValue("--line-cols")),
        cellWidthPx: readPx("--grid-cell-width"),
        previewSizePx: readPx("--grid-preview-size"),
        lineHeightPx: readPx("--tile-line-height"),
      };
    }

    function isBefore(element, laterElement) {
      return Boolean(element.compareDocumentPosition(laterElement) & Node.DOCUMENT_POSITION_FOLLOWING);
    }

    // The returned function resizes the foldable grid and reports it to the ResizeObservers made
    // after this call, as a browser would.
    function observeFoldableGridResizes() {
      const reportResizes = new Set();
      vi.stubGlobal("ResizeObserver", class {
        constructor(callback) {
          this.callback = callback;
        }

        observe() {
          reportResizes.add(this.callback);
        }

        unobserve() { /* the test reports every resize to every observer */ }

        disconnect() {
          reportResizes.delete(this.callback);
        }
      });
      return (widthPx) => {
        foldableGridWidthPx = widthPx;
        act(() => reportResizes.forEach((reportResize) => reportResize([])));
      };
    }

    // C:\ holds the folder Media (files m1..m3), then the files a..f. At 600 px and 128 px
    // thumbnails a root line holds 4 tiles, so the lines are [Media] [a b c d] [e f]. Entries put
    // into the returned array show up in later listings of C:\.
    function mockMediaListing() {
      const rootEntries = [
        { name: "Media", path: "C:\\Media", is_dir: true },
        ...["a", "b", "c", "d", "e", "f"].map((name) => ({ name, path: `C:\\${name}`, is_dir: false })),
      ];
      const mediaEntries = ["m1", "m2", "m3"].map((name) => ({ name, path: `C:\\Media\\${name}`, is_dir: false }));
      const baseInvoke = invoke.getMockImplementation();
      invoke.mockImplementation(async (command, payload) => {
        if (command === "list_directory_page" && payload?.path === "C:\\") {
          const entries = rootEntries.slice(payload.offset, payload.offset + payload.limit);
          const hasMore = payload.offset + entries.length < rootEntries.length;
          return { entries, hasMore, totalCount: rootEntries.length };
        }
        if (command === "list_directory" && payload?.path === "C:\\Media")
          return mediaEntries.map((entry) => ({ ...entry }));
        return baseInvoke(command, payload);
      });
      return rootEntries;
    }

    // Another program changed something in C:\: its watcher reports it, and C:\ is listed again.
    async function reportRootChange(changedPath) {
      const rootWatchId = invoke.mock.calls.findLast(([command, payload]) => (
        command === "filesystem_watch_start" && payload?.path === "C:\\"
      ))?.[1]?.watchId;
      await filesystemWatchCallback({ payload: { watchId: rootWatchId, changedPath } });
    }

    function pressInFoldableGrid(key, options = {}) {
      fireEvent.keyDown(screen.getByTestId("filesystem-foldable-grid"), { key, ...options });
    }

    it("shows folders as rows and files as tiles once switched to the view", async () => {
      renderFilesystemPanel({
        paneId: "pane-foldable-switch",
        filesystemState: { currentDrive: "C:\\", currentPath: "C:\\", scrollTop: 0 },
      });
      await screen.findByRole("button", { name: /notes\.txt/i });
      expect(screen.queryByTestId("filesystem-foldable-grid")).not.toBeInTheDocument();

      dispatchFilesystemCommand("filesystem.view.foldableGrid", "pane-foldable-switch");

      const foldableGrid = await screen.findByTestId("filesystem-foldable-grid");
      expect(getShownPaths()).toEqual(["C:\\Users", "C:\\Temp", "C:\\notes.txt", "C:\\draft.md", "C:\\.grayspace"]);
      const usersRow = within(foldableGrid).getByRole("button", { name: /Users/ });
      expect(usersRow.querySelector("[data-entry-expander]")).toBeTruthy();
      expect(within(usersRow).getByText("Folder")).toBeInTheDocument();
      const notesTile = within(foldableGrid).getByRole("button", { name: "notes.txt" });
      const draftTile = within(foldableGrid).getByRole("button", { name: "draft.md" });
      expect(notesTile.className).toMatch(/cell/);
      expect(notesTile.querySelector("[data-entry-expander]")).toBeNull();
      expect(within(notesTile).queryByText("File")).not.toBeInTheDocument();
      expect(getTileRun(notesTile)).toBe(getTileRun(draftTile));
      expect(screen.getByTestId("filesystem-panel-scroll-container").className).toMatch(/gridPanelBody/);
    });

    it("opens a folder in place from its expander: its subfolders as rows, then its files as tiles, one level in", async () => {
      const onCurrentPathChange = vi.fn();
      // No tab: Users is a workspace folder, which a tab would open in a new tab.
      renderFoldableGrid({}, { tabId: "", onCurrentPathChange });
      const usersRow = await screen.findByRole("button", { name: /Users/ });

      fireEvent.click(usersRow.querySelector("[data-entry-expander]"));

      const todoTile = await screen.findByRole("button", { name: "todo.txt" });
      expect(getShownPaths()).toEqual([
        "C:\\Users",
        "C:\\Users\\Projects",
        "C:\\Users\\todo.txt",
        "C:\\Users\\.grayspace",
        "C:\\Temp",
        "C:\\notes.txt",
        "C:\\draft.md",
        "C:\\.grayspace",
      ]);
      expect(todoTile.className).toMatch(/cell/);
      // The rows' indent guide runs on through the tiles.
      expect(screen.getByRole("button", { name: /Projects/ }).querySelectorAll("[class*='indentGuide']")).toHaveLength(1);
      expect(getTileRun(todoTile).querySelectorAll("[class*='indentGuide']")).toHaveLength(1);
      expect(usersRow).toHaveAttribute("aria-selected", "false");
      expect(onCurrentPathChange).toHaveBeenLastCalledWith("C:\\");

      fireEvent.click(usersRow.querySelector("[data-entry-expander]"));
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "todo.txt" })).not.toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: /Projects/ })).not.toBeInTheDocument();

      // A double-click on the expander stays there; one on the row goes into the folder.
      fireEvent.doubleClick(usersRow.querySelector("[data-entry-expander]"));
      await flushPromises();
      expect(onCurrentPathChange).toHaveBeenLastCalledWith("C:\\");
      expect(usersRow).toHaveAttribute("aria-selected", "false");

      fireEvent.doubleClick(usersRow);
      await waitFor(() => {
        expect(onCurrentPathChange).toHaveBeenLastCalledWith("C:\\Users");
      });
    });

    it("selects a Shift+click range in reading order, across levels", async () => {
      const onFilesystemStateChange = vi.fn();
      renderFoldableGrid({ expandedPaths: ["C:\\Users"] }, { onFilesystemStateChange });
      fireEvent.click(await screen.findByRole("button", { name: "todo.txt" }));

      fireEvent.click(screen.getByRole("button", { name: "notes.txt" }), { shiftKey: true });

      const range = ["C:\\Users\\todo.txt", "C:\\Users\\.grayspace", "C:\\Temp", "C:\\notes.txt"];
      await waitFor(() => {
        expect(onFilesystemStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ selectedPaths: range }));
      });
      expect(getShownSelection()).toEqual(range);
    });

    // The tiles' cells and gaps fill their level's width, but for under a pixel per cell lost to
    // rounding, so no column is left empty.
    function expectTilesToFillLine(tile, lineWidthPx) {
      const { columnCount, cellWidthPx } = getTileSizes(tile);
      const filledWidthPx = columnCount * cellWidthPx + (columnCount - 1) * 8;
      expect(filledWidthPx).toBeLessThanOrEqual(lineWidthPx);
      expect(filledWidthPx).toBeGreaterThan(lineWidthPx - columnCount);
    }

    it("gives an opened folder its parent's columns, in tiles a little smaller that fill the folder's width", async () => {
      // 602 px, so the cells don't divide evenly and must round down to fit.
      foldableGridWidthPx = 602;
      renderFoldableGrid({ thumbnailSizePx: 128, expandedPaths: ["C:\\Users"] });
      const todoTile = await screen.findByRole("button", { name: "todo.txt" });
      const notesTile = screen.getByRole("button", { name: "notes.txt" });

      // As in grid view, 602 px minus 8 px padding each side holds 4 cells of at least 138 px with
      // 8 px gaps, widened to 140 px: 130 px previews on 170 px lines.
      expect(getTileSizes(notesTile)).toEqual({ columnCount: 4, cellWidthPx: 140, previewSizePx: 130, lineHeightPx: 170 });
      expectTilesToFillLine(notesTile, 586);
      // One level in, the 24 px indent leaves 562 px: still 4 cells, of 134 px, under 10% narrower
      // than 138 px.
      expect(getTileSizes(todoTile)).toEqual({ columnCount: 4, cellWidthPx: 134, previewSizePx: 124, lineHeightPx: 164 });
      expectTilesToFillLine(todoTile, 562);
      // Folder rows stay 32 px tall.
      expect(screen.getByTestId("filesystem-foldable-grid").style.getPropertyValue("--entry-row-height")).toBe("32px");
    });

    it("drops a column in a level whose tiles would shrink by more than 10% to keep their parent's, and fills its width", async () => {
      // Users > Projects > Site > Assets, each holding a file: tiles 1 to 4 levels in.
      const nestedEntries = {
        "C:\\Users\\Projects": [
          { name: "plan.md", path: "C:\\Users\\Projects\\plan.md", is_dir: false },
          { name: "Site", path: "C:\\Users\\Projects\\Site", is_dir: true },
        ],
        "C:\\Users\\Projects\\Site": [
          { name: "index.html", path: "C:\\Users\\Projects\\Site\\index.html", is_dir: false },
          { name: "Assets", path: "C:\\Users\\Projects\\Site\\Assets", is_dir: true },
        ],
        "C:\\Users\\Projects\\Site\\Assets": [
          { name: "logo.png", path: "C:\\Users\\Projects\\Site\\Assets\\logo.png", is_dir: false },
        ],
      };
      const baseInvoke = invoke.getMockImplementation();
      invoke.mockImplementation(async (command, payload) => (
        command === "list_directory" && nestedEntries[payload?.path]
          ? nestedEntries[payload.path].map((entry) => ({ ...entry }))
          : baseInvoke(command, payload)
      ));
      renderFoldableGrid({ thumbnailSizePx: 128, expandedPaths: ["C:\\Users", ...Object.keys(nestedEntries)] });
      const logoTile = await screen.findByRole("button", { name: "logo.png" });

      // Each level in is 16 px narrower. The 4 columns stay while their cells are at least 90% of
      // 138 px: 130 px in 544 px two levels in, 126 px in 528 px three in.
      const planTile = screen.getByRole("button", { name: "plan.md" });
      const indexTile = screen.getByRole("button", { name: "index.html" });
      expect(getTileSizes(planTile)).toMatchObject({ columnCount: 4, cellWidthPx: 130 });
      expect(getTileSizes(indexTile)).toMatchObject({ columnCount: 4, cellWidthPx: 126 });
      expectTilesToFillLine(planTile, 544);
      expectTilesToFillLine(indexTile, 528);
      // Four levels in, 4 cells would be 122 px. 3 cells of at least 138 px fit in 512 px, widened
      // to 165 px.
      expect(getTileSizes(logoTile)).toEqual({ columnCount: 3, cellWidthPx: 165, previewSizePx: 155, lineHeightPx: 195 });
      expectTilesToFillLine(logoTile, 512);
    });

    it("shows a loading line under a folder listed for the first time, then what it holds", async () => {
      const usersListingGate = Promise.withResolvers();
      const baseInvoke = invoke.getMockImplementation();
      invoke.mockImplementation(async (command, payload) => {
        if (command === "list_directory" && payload?.path === "C:\\Users") await usersListingGate.promise;
        return baseInvoke(command, payload);
      });
      renderFoldableGrid();
      const usersRow = await screen.findByRole("button", { name: /Users/ });

      fireEvent.click(usersRow.querySelector("[data-entry-expander]"));

      const loadingRow = (await screen.findByText("Loading...")).closest("button");
      expect(loadingRow).not.toHaveAttribute("data-context-id");
      expect(loadingRow.querySelectorAll("[class*='indentGuide']")).toHaveLength(1);
      expect(isBefore(usersRow, loadingRow)).toBe(true);
      expect(isBefore(loadingRow, screen.getByRole("button", { name: /Temp/ }))).toBe(true);

      await act(async () => {
        usersListingGate.resolve();
      });

      expect(await screen.findByRole("button", { name: "todo.txt" })).toBeInTheDocument();
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });

    it("asks for thumbnails of every tile it renders, nested ones included, at grid view's cached sizes", async () => {
      function getLatestThumbnailItems() {
        const latestCall = invoke.mock.calls.findLast(([command]) => command === "thumbnail_resolve_batch");
        return latestCall?.[1]?.request?.items ?? [];
      }
      const filesystemState = { thumbnailSizePx: 128, expandedPaths: ["C:\\Users"] };
      const { unmount } = renderFoldableGrid(filesystemState);
      await screen.findByRole("button", { name: "todo.txt" });

      // Files only, in reading order; 128 px previews fill their 140 px cells and use the 256 px cache.
      await waitFor(() => {
        expect(getLatestThumbnailItems()).toEqual(["C:\\Users\\todo.txt", "C:\\notes.txt", "C:\\draft.md"]
          .map((sourcePath) => ({ sourcePath, sizeHintPx: 256, priority: "visible" })));
      });
      unmount();

      // From 192 px up, previews can pass 256 px, so the 512 px cache is used.
      invoke.mockClear();
      const { unmount: unmountLarge } = renderFoldableGrid({ ...filesystemState, thumbnailSizePx: 192 });
      await screen.findByRole("button", { name: "todo.txt" });
      await waitFor(() => {
        expect(getLatestThumbnailItems()[0]).toEqual(expect.objectContaining({ sizeHintPx: 512 }));
      });
      unmountLarge();

      // Small icons keep their size at every level, and the small cache.
      invoke.mockClear();
      renderFoldableGrid({ ...filesystemState, thumbnailSizePx: 48 });
      const smallTodoTile = await screen.findByRole("button", { name: "todo.txt" });
      expect(getTileSizes(smallTodoTile).previewSizePx).toBe(48);
      expect(getTileSizes(screen.getByRole("button", { name: "notes.txt" })).previewSizePx).toBe(48);
      await waitFor(() => {
        expect(getLatestThumbnailItems()[0]).toEqual(expect.objectContaining({ sizeHintPx: 64 }));
      });
    });

    it("styles workspace folders among the rows it renders, nested ones included", async () => {
      const baseInvoke = invoke.getMockImplementation();
      invoke.mockImplementation(async (command, payload) => (
        command === "filesystem_resolve_workspace_folders"
          ? Object.fromEntries(payload.paths.map((path) => [path, path === "C:\\Users\\Projects"]))
          : baseInvoke(command, payload)
      ));
      renderFoldableGrid({ expandedPaths: ["C:\\Users"] });

      const projectsRow = await screen.findByRole("button", { name: /Projects/ });
      await waitFor(() => {
        expect(projectsRow.className).toMatch(/configEntry/);
      });
    });

    it("renders only the lines near the viewport in large folders, and pages, thumbnails and workspace folders follow them", async () => {
      // One column: each file is a 62 px tile line (22 px previews).
      foldableGridWidthPx = 0;
      const largeEntries = Array.from({ length: 500 }, (_, index) => {
        const name = `file-${String(index).padStart(4, "0")}.txt`;
        return { name, path: `C:\\${name}`, is_dir: false };
      });
      largeEntries[330] = { name: "Workspace", path: "C:\\Workspace", is_dir: true };
      const baseInvoke = invoke.getMockImplementation();
      invoke.mockImplementation(async (command, payload) => {
        if (command === "filesystem_resolve_workspace_folders")
          return Object.fromEntries(payload.paths.map((path) => [path, path === "C:\\Workspace"]));
        if (command !== "list_directory_page" || payload?.path !== "C:\\") return baseInvoke(command, payload);
        const pageEntries = largeEntries.slice(payload.offset, payload.offset + payload.limit);
        const hasMore = payload.offset + pageEntries.length < largeEntries.length;
        return { entries: pageEntries, hasMore, totalCount: largeEntries.length };
      });
      renderFoldableGrid();

      expect(await screen.findByRole("button", { name: "file-0000.txt" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /file-04\d\d\.txt/ })).not.toBeInTheDocument();

      // The folder tree's window, kept for that view, stays at the top.
      const scrollContainer = screen.getByTestId("filesystem-panel-scroll-container");
      scrollContainer.scrollTop = 330 * 62;
      fireEvent.scroll(scrollContainer);

      const workspaceRow = await screen.findByRole("button", { name: /Workspace/ });
      expect(screen.getAllByRole("button", { name: /file-\d{4}\.txt/ }).length).toBeLessThan(450);
      expect(invoke).toHaveBeenCalledWith("list_directory_page", expect.objectContaining({ path: "C:\\", offset: 120 }));
      await waitFor(() => {
        expect(workspaceRow.className).toMatch(/configEntry/);
      });
      await waitFor(() => {
        const latestCall = invoke.mock.calls.findLast(([command]) => command === "thumbnail_resolve_batch");
        expect(latestCall[1].request.items).toContainEqual(expect.objectContaining({ sourcePath: "C:\\file-0331.txt" }));
      });
    });

    it("shows folder results as rows with their location and file results as one block of tiles, below the status line", async () => {
      renderFoldableGrid();
      await screen.findByRole("button", { name: "notes.txt" });

      await showSearchResults("pane-foldable", "o", [
        { name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false },
        { name: "Projects", path: "C:\\Users\\Projects", is_dir: true },
        { name: "notes.txt", path: "C:\\notes.txt", is_dir: false },
      ]);

      const projectsRow = await screen.findByRole("button", { name: /Projects/ });
      expect(isBefore(screen.getByRole("status"), screen.getByTestId("filesystem-foldable-grid"))).toBe(true);
      expect(getShownPaths()).toEqual(["C:\\Users\\Projects", "C:\\notes.txt", "C:\\Users\\todo.txt"]);
      expect(projectsRow.querySelector("[data-entry-expander]")).toBeTruthy();
      expect(within(projectsRow).getByText("Users")).toBeInTheDocument();
      const todoTile = screen.getByRole("button", { name: "todo.txt" });
      expect(todoTile.className).toMatch(/cell/);
      expect(within(todoTile).queryByText("Users")).not.toBeInTheDocument();
      expect(getTileRun(todoTile)).toBe(getTileRun(screen.getByRole("button", { name: "notes.txt" })));
      // A file result takes drops for the folder it is in, not for the searched one.
      expect(todoTile).toHaveAttribute("data-drop-destination-path", "C:\\Users");
    });

    it("filters the top level only and says above the grid when nothing matches", async () => {
      renderFoldableGrid({ expandedPaths: ["C:\\Users"] });
      await screen.findByRole("button", { name: "todo.txt" });

      dispatchFilesystemCommand("filesystem.filterCurrentFolder", "pane-foldable");
      const filterInput = await screen.findByRole("searchbox", { name: "Filter current folder" });
      fireEvent.change(filterInput, { target: { value: "users" } });

      // The opened Users matches, and shows all it holds.
      await waitFor(() => {
        expect(getShownPaths()).toEqual([
          "C:\\Users",
          "C:\\Users\\Projects",
          "C:\\Users\\todo.txt",
          "C:\\Users\\.grayspace",
        ]);
      });

      fireEvent.change(filterInput, { target: { value: "zzz" } });
      const unmatchedNote = await screen.findByText('No items match "zzz".');
      await waitFor(() => {
        expect(isBefore(unmatchedNote, screen.getByTestId("filesystem-foldable-grid"))).toBe(true);
      });
    });

    it("renames a tile inside an opened folder on F2", async () => {
      renderFoldableGrid({ expandedPaths: ["C:\\Users"] });
      const todoTile = await screen.findByRole("button", { name: "todo.txt" });

      fireEvent.click(todoTile);
      todoTile.focus();
      fireEvent.keyDown(todoTile, { key: "F2" });

      const renameInput = await screen.findByRole("textbox");
      expect(renameInput).toHaveValue("todo.txt");
      expect(renameInput.className).toMatch(/cellRenameInput/);
      fireEvent.change(renameInput, { target: { value: "done.txt" } });
      fireEvent.keyDown(renameInput, { key: "Enter" });

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("rename_path", {
          path: "C:\\Users\\todo.txt",
          newName: "done.txt",
        });
      });
      expect(await screen.findByRole("button", { name: "done.txt" })).toBeInTheDocument();
    });

    it("keeps a tile, and its focus, when an item is added before it or the columns change", async () => {
      const rootEntries = mockMediaListing();
      const resizeFoldableGrid = observeFoldableGridResizes();
      renderFoldableGrid({ thumbnailSizePx: 128 });
      const dTile = await screen.findByRole("button", { name: "d" });
      dTile.focus();

      // a0 pushes d onto the next line: [a a0 b c] [d e f].
      rootEntries.splice(2, 0, { name: "a0", path: "C:\\a0", is_dir: false });
      await reportRootChange("C:\\a0");
      await screen.findByRole("button", { name: "a0" });
      expect(screen.getByRole("button", { name: "d" })).toBe(dTile);
      expect(dTile).toHaveFocus();

      // At 2 columns d moves down a line again: [a a0] [b c] [d e] [f].
      resizeFoldableGrid(400);
      expect(getTileRun(dTile).style.getPropertyValue("--line-cols")).toBe("2");
      expect(screen.getByRole("button", { name: "d" })).toBe(dTile);
      expect(dTile).toHaveFocus();
    });

    it("keeps what was typed into a tile's rename when an item is added before it or the columns change", async () => {
      const rootEntries = mockMediaListing();
      const resizeFoldableGrid = observeFoldableGridResizes();
      renderFoldableGrid({ thumbnailSizePx: 128 });
      const dTile = await screen.findByRole("button", { name: "d" });
      fireEvent.click(dTile);
      dTile.focus();
      fireEvent.keyDown(dTile, { key: "F2" });
      const renameInput = await screen.findByRole("textbox");
      fireEvent.change(renameInput, { target: { value: "d-renamed" } });

      rootEntries.splice(2, 0, { name: "a0", path: "C:\\a0", is_dir: false });
      await reportRootChange("C:\\a0");
      await screen.findByRole("button", { name: "a0" });
      expect(screen.getByRole("textbox")).toBe(renameInput);
      expect(renameInput).toHaveValue("d-renamed");

      resizeFoldableGrid(400);
      expect(getTileRun(renameInput).style.getPropertyValue("--line-cols")).toBe("2");
      expect(screen.getByRole("textbox")).toBe(renameInput);
      expect(renameInput).toHaveValue("d-renamed");
    });

    it("asks for thumbnails again when a folder is listed again, but not for a resize that keeps every column count", async () => {
      const resizeFoldableGrid = observeFoldableGridResizes();
      renderFoldableGrid({ thumbnailSizePx: 128, expandedPaths: ["C:\\Users"] });
      const todoTile = await screen.findByRole("button", { name: "todo.txt" });
      const countThumbnailBatches = () => (
        invoke.mock.calls.filter(([command]) => command === "thumbnail_resolve_batch").length
      );
      await waitFor(() => {
        expect(countThumbnailBatches()).toBeGreaterThan(0);
      });
      await flushPromises(100);
      const batchCount = countThumbnailBatches();

      // 604 px widens the cells to 141 px at the root and to 135 px in Users; the lines still hold
      // 4 tiles at both levels.
      resizeFoldableGrid(604);
      await flushPromises(100);
      expect(getTileSizes(screen.getByRole("button", { name: "notes.txt" })))
        .toMatchObject({ columnCount: 4, cellWidthPx: 141 });
      expect(getTileSizes(todoTile)).toMatchObject({ columnCount: 4, cellWidthPx: 135 });
      expect(countThumbnailBatches()).toBe(batchCount);

      // Users is listed again (todo.txt was edited), so its thumbnail may be out of date.
      let usersWatchId;
      await waitFor(() => {
        usersWatchId = invoke.mock.calls.findLast(([command, payload]) => (
          command === "filesystem_watch_start" && payload?.path === "C:\\Users"
        ))?.[1]?.watchId;
        expect(usersWatchId).toEqual(expect.any(String));
      });
      await filesystemWatchCallback({ payload: { watchId: usersWatchId, changedPath: "C:\\Users\\todo.txt" } });
      await waitFor(() => {
        expect(countThumbnailBatches()).toBe(batchCount + 1);
      });
    });

    it("opens a closed folder something was created in from its menu, and renames the new row there", async () => {
      renderFoldableGrid();
      await screen.findByRole("button", { name: /Users/ });

      act(() => {
        window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
          detail: {
            commandId: "filesystem.createFolder",
            context: {
              source: "context-menu",
              targetPaneId: "pane-foldable",
              targetType: "folder",
              targetScope: "tree-entry",
              targetPath: "C:\\Users",
            },
          },
        }));
      });

      const renameInput = await screen.findByRole("textbox");
      expect(renameInput).toHaveValue("New folder");
      expect(screen.getByTestId("filesystem-foldable-grid")).toContainElement(renameInput);
      expect(screen.getByRole("button", { name: "todo.txt" })).toBeInTheDocument();
      // The new folder's row, renamed in place inside the opened Users.
      expect(renameInput.className).toMatch(/entryRenameInput/);
      expect(isBefore(screen.getByRole("button", { name: /^Users/ }), renameInput)).toBe(true);
      expect(isBefore(renameInput, screen.getByRole("button", { name: /^Temp/ }))).toBe(true);
      // Users is listed only once the folder exists, so the listing holds it.
      const createIndex = invoke.mock.calls.findIndex(([command]) => command === "create_folder");
      const usersListingIndex = invoke.mock.calls.findIndex(([command, payload]) => (
        command === "list_directory" && payload?.path === "C:\\Users"
      ));
      expect(createIndex).toBeGreaterThanOrEqual(0);
      expect(usersListingIndex).toBeGreaterThan(createIndex);
    });

    it("lets nested tiles be dragged, and drops on them go into their folder, whose row lights up", async () => {
      renderFoldableGrid({ expandedPaths: ["C:\\Users"] }, { paneId: "pane-foldable-dnd" });
      const todoTile = await screen.findByRole("button", { name: "todo.txt" });
      const usersRow = screen.getByRole("button", { name: /^Users/ });
      expect(todoTile).toHaveAttribute("data-drop-destination-path", "C:\\Users");
      expect(todoTile).toHaveAttribute("data-context-scope", "tree-entry");
      expect(useDraggable).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ sourcePath: "C:\\Users\\todo.txt", sourcePaneId: "pane-foldable-dnd" }),
      }));

      dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\notes.txt" } });
      dndCallbacks.onDragOver?.({
        active: { id: "entry:C:\\notes.txt" },
        over: { id: "entry:C:\\Users\\todo.txt" },
      });
      await waitFor(() => {
        expect(usersRow.className).toMatch(/dropTarget/);
      });
      expect(todoTile.className).not.toMatch(/cellDropTarget/);

      await dndCallbacks.onDragEnd?.({
        active: { id: "entry:C:\\notes.txt" },
        over: { id: "entry:C:\\Users\\todo.txt" },
      });
      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
          source: "C:\\notes.txt",
          destinationDir: "C:\\Users",
        }));
      });
    });

    it("middle-clicks nested tiles and rows like tree rows", async () => {
      const onTabSelectedFilesChange = vi.fn();
      renderFoldableGrid({ expandedPaths: ["C:\\Users"] }, { tabId: "tab-foldable-middle", onTabSelectedFilesChange });
      const todoTile = await screen.findByRole("button", { name: "todo.txt" });

      fireEvent.mouseDown(todoTile, { button: 1 });
      fireEvent.mouseUp(todoTile, { button: 1 });
      expect(onTabSelectedFilesChange).toHaveBeenLastCalledWith(expect.objectContaining({
        selectedPaths: ["C:\\Users\\todo.txt"],
        previewOpenMode: "pinned",
      }));

      const projectsRow = screen.getByRole("button", { name: /Projects/ });
      fireEvent.mouseDown(projectsRow, { button: 1 });
      fireEvent.mouseUp(projectsRow, { button: 1 });
      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("workspace_open_folder_from_tab", {
          payload: { tabId: "tab-foldable-middle", path: "C:\\Users\\Projects" },
        });
      });
    });

    it("shares opened folders with the other views, which draw them as before", async () => {
      const onFilesystemStateChange = vi.fn();
      renderFoldableGrid({ expandedPaths: ["C:\\Users"] }, { onFilesystemStateChange });
      expect((await screen.findByRole("button", { name: "todo.txt" })).className).toMatch(/cell/);

      dispatchFilesystemCommand("filesystem.view.folderTree", "pane-foldable");
      await waitFor(() => {
        expect(screen.queryByTestId("filesystem-foldable-grid")).not.toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: /todo\.txt/ }).className).not.toMatch(/cell/);
      expect(onFilesystemStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
        viewType: "folder-tree",
        expandedPaths: ["C:\\Users"],
      }));

      dispatchFilesystemCommand("filesystem.view.grid", "pane-foldable");
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /todo\.txt/ })).not.toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: "Users" }).className).toMatch(/cell/);
      expect(screen.queryByTestId("filesystem-foldable-grid")).not.toBeInTheDocument();
    });

    it("moves by column with Up/Down, a folder row counting as column 0, and loops at the ends", async () => {
      mockMediaListing();
      renderFoldableGrid({ thumbnailSizePx: 128 });
      fireEvent.click(await screen.findByRole("button", { name: "b" }));
      expect(getTileRun(screen.getByRole("button", { name: "b" })).style.getPropertyValue("--line-cols")).toBe("4");

      pressInFoldableGrid("ArrowDown");
      expect(getShownSelection()).toEqual(["C:\\f"]);

      // Clamped to the shorter line.
      fireEvent.click(screen.getByRole("button", { name: "c" }));
      pressInFoldableGrid("ArrowDown");
      expect(getShownSelection()).toEqual(["C:\\f"]);

      fireEvent.click(screen.getByRole("button", { name: "a" }));
      pressInFoldableGrid("ArrowUp");
      expect(getShownSelection()).toEqual(["C:\\Media"]);
      pressInFoldableGrid("ArrowUp");
      expect(getShownSelection()).toEqual(["C:\\e"]);
    });

    it("opens and closes folder rows with Right/Left, and otherwise steps through the reading order up to either end", async () => {
      mockMediaListing();
      renderFoldableGrid({ thumbnailSizePx: 128 });
      const mediaRow = await screen.findByRole("button", { name: /^Media/ });

      fireEvent.click(screen.getByRole("button", { name: "d" }));
      pressInFoldableGrid("ArrowRight");
      expect(getShownSelection()).toEqual(["C:\\e"]);
      pressInFoldableGrid("ArrowLeft");
      expect(getShownSelection()).toEqual(["C:\\d"]);

      fireEvent.click(screen.getByRole("button", { name: "a" }));
      pressInFoldableGrid("ArrowLeft");
      expect(getShownSelection()).toEqual(["C:\\Media"]);
      pressInFoldableGrid("ArrowLeft");
      expect(getShownSelection()).toEqual(["C:\\Media"]);
      fireEvent.click(screen.getByRole("button", { name: "f" }));
      pressInFoldableGrid("ArrowRight");
      expect(getShownSelection()).toEqual(["C:\\f"]);

      fireEvent.click(mediaRow);
      pressInFoldableGrid("ArrowRight");
      expect(await screen.findByRole("button", { name: "m1" })).toBeInTheDocument();
      expect(getShownSelection()).toEqual(["C:\\Media"]);
      pressInFoldableGrid("ArrowRight");
      expect(getShownSelection()).toEqual(["C:\\Media\\m1"]);
      pressInFoldableGrid("ArrowLeft");
      expect(getShownSelection()).toEqual(["C:\\Media"]);
      pressInFoldableGrid("ArrowLeft");
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "m1" })).not.toBeInTheDocument();
      });
      expect(getShownSelection()).toEqual(["C:\\Media"]);
    });

    it("extends Shift ranges in reading order up to either end, and Shift+Right/Left never open or close folders", async () => {
      mockMediaListing();
      renderFoldableGrid({ thumbnailSizePx: 128 });
      const rootPaths = ["C:\\Media", "C:\\a", "C:\\b", "C:\\c", "C:\\d", "C:\\e", "C:\\f"];
      fireEvent.click(await screen.findByRole("button", { name: "b" }));

      pressInFoldableGrid("ArrowDown", { shiftKey: true });
      expect(getShownSelection()).toEqual(rootPaths.slice(2));

      // Each Shift+Up goes on from the line it reached, not from the anchor.
      fireEvent.click(screen.getByRole("button", { name: "f" }));
      pressInFoldableGrid("ArrowUp", { shiftKey: true });
      expect(getShownSelection()).toEqual(rootPaths.slice(2));
      pressInFoldableGrid("ArrowUp", { shiftKey: true });
      expect(getShownSelection()).toEqual(rootPaths);
      pressInFoldableGrid("ArrowUp", { shiftKey: true });
      pressInFoldableGrid("ArrowLeft", { shiftKey: true });
      expect(getShownSelection()).toEqual(rootPaths);

      fireEvent.click(screen.getByRole("button", { name: /^Media/ }));
      pressInFoldableGrid("ArrowRight", { shiftKey: true });
      expect(getShownSelection()).toEqual(["C:\\Media", "C:\\a"]);
      expect(screen.queryByRole("button", { name: "m1" })).not.toBeInTheDocument();

      pressInFoldableGrid("ArrowLeft", { shiftKey: true });
      pressInFoldableGrid("ArrowRight");
      await screen.findByRole("button", { name: "m1" });
      pressInFoldableGrid("ArrowLeft", { shiftKey: true });
      expect(getShownSelection()).toEqual(["C:\\Media"]);
      expect(screen.getByRole("button", { name: "m1" })).toBeInTheDocument();
    });

    it("takes arrow keys from the list and, in the active pane, from the window, once each and not while held", async () => {
      mockMediaListing();
      render(
        <PanelsDndLayer>
          <div data-pane-active="true">
            <FilesystemPanel
              tabId="tab-foldable-keys"
              paneId="pane-foldable-keys"
              filesystemState={{
                currentDrive: "C:\\",
                currentPath: "C:\\",
                scrollTop: 0,
                viewType: "foldable-grid",
                thumbnailSizePx: 128,
              }}
            />
          </div>
        </PanelsDndLayer>,
      );
      fireEvent.click(await screen.findByRole("button", { name: "b" }));

      // Nothing has focus, as after a click on a header button: the window passes the key on.
      fireEvent.keyDown(document.body, { key: "ArrowDown" });
      expect(getShownSelection()).toEqual(["C:\\f"]);

      // Handled by the list, so the window leaves it: one step up, and the folder opened only once.
      fireEvent.keyDown(screen.getByRole("button", { name: "f" }), { key: "ArrowUp" });
      expect(getShownSelection()).toEqual(["C:\\b"]);
      const mediaRow = screen.getByRole("button", { name: /^Media/ });
      fireEvent.click(mediaRow);
      fireEvent.keyDown(mediaRow, { key: "ArrowRight" });
      expect(await screen.findByRole("button", { name: "m1" })).toBeInTheDocument();

      fireEvent.keyDown(mediaRow, { key: "ArrowRight", repeat: true });
      fireEvent.keyDown(document.body, { key: "ArrowDown", repeat: true });
      expect(getShownSelection()).toEqual(["C:\\Media"]);
    });

    it.each(["folder-tree", "details", "grid"])("keeps Up/Down to the entry order and Right/Left to folders in %s view", async (viewType) => {
      renderFoldableGrid({ viewType, thumbnailSizePx: 128 });
      const usersButton = await screen.findByRole("button", { name: /^Users/ });
      const notesButton = screen.getByRole("button", { name: /notes\.txt/ });

      // Grid view lays the five entries out in 4 columns, and Down still goes to the next one.
      fireEvent.click(usersButton);
      fireEvent.keyDown(usersButton, { key: "ArrowDown" });
      expect(getShownSelection()).toEqual(["C:\\Temp"]);

      fireEvent.click(notesButton);
      fireEvent.keyDown(notesButton, { key: "ArrowRight" });
      fireEvent.keyDown(notesButton, { key: "ArrowLeft" });
      expect(getShownSelection()).toEqual(["C:\\notes.txt"]);
    });

    it("takes drops in the empty space between an opened folder's tiles into that folder, lighting its row and tiles", async () => {
      // Users lists todo.txt between two folders, then u1..u5: at 128 px, 4 columns in Users, so
      // two lines of one run.
      mockLaterUsersEntries().push(...["u1", "u2", "u3", "u4", "u5"].map((name) => ({
        name,
        path: `C:\\Users\\${name}`,
        is_dir: false,
      })));
      renderFoldableGrid({ thumbnailSizePx: 128, expandedPaths: ["C:\\Users"] }, { paneId: "pane-foldable-gap" });
      const todoTile = await screen.findByRole("button", { name: "todo.txt" });
      const usersRow = screen.getByRole("button", { name: /^Users/ });
      const usersRun = getTileRun(todoTile);
      const laterUsersRun = getTileRun(screen.getByRole("button", { name: "u1" }));
      const rootRun = getTileRun(screen.getByRole("button", { name: "notes.txt" }));
      expect(getTileRun(screen.getByRole("button", { name: "u5" }))).toBe(laterUsersRun);
      expect(usersRun).toHaveAttribute("data-drop-destination-path", "C:\\Users");
      expect(laterUsersRun).toHaveAttribute("data-drop-destination-path", "C:\\Users");
      expect(rootRun).not.toHaveAttribute("data-drop-destination-path");
      // A droppable per line of a run, scoped to the pane: another pane can show the same tiles.
      const lineDroppables = useDroppable.mock.calls
        .map(([options]) => options)
        .filter((options) => options.data?.kind === "folder-run");
      const findLineDroppable = (id) => lineDroppables.findLast((options) => options.id === id);
      const usersRunDroppable = findLineDroppable("foldable-run:pane-foldable-gap:tiles:1:C:\\Users:0:0");
      expect(usersRunDroppable).toEqual({
        id: "foldable-run:pane-foldable-gap:tiles:1:C:\\Users:0:0",
        disabled: false,
        data: { kind: "folder-run", path: "C:\\Users", isDirectory: true, paneId: "pane-foldable-gap" },
      });
      expect(usersRun.querySelectorAll("[class*='tileRunLine']")).toHaveLength(1);
      expect(laterUsersRun.querySelectorAll("[class*='tileRunLine']")).toHaveLength(2);
      ["foldable-run:pane-foldable-gap:tiles:1:C:\\Users:1:0", "foldable-run:pane-foldable-gap:tiles:1:C:\\Users:1:1"]
        .forEach((id) => {
          expect(findLineDroppable(id)).toEqual({ id, disabled: false, data: usersRunDroppable.data });
        });
      // Root runs leave drops to the pane: the current folder.
      expect(rootRun.querySelectorAll("[class*='tileRunLine']")).toHaveLength(0);
      expect(lineDroppables.some((options) => options.data.path === "C:\\")).toBe(false);

      const overUsersRun = { id: usersRunDroppable.id, data: { current: usersRunDroppable.data } };
      dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\notes.txt" } });
      dndCallbacks.onDragOver?.({ active: { id: "entry:C:\\notes.txt" }, over: overUsersRun });
      await waitFor(() => {
        expect(usersRun.className).toMatch(/tileRunDropTarget/);
      });
      expect(laterUsersRun.className).toMatch(/tileRunDropTarget/);
      expect(usersRow.className).toMatch(/dropTarget/);
      expect(rootRun.className).not.toMatch(/tileRunDropTarget/);

      await dndCallbacks.onDragEnd?.({ active: { id: "entry:C:\\notes.txt" }, over: overUsersRun });
      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
          source: "C:\\notes.txt",
          destinationDir: "C:\\Users",
        }));
      });
    });

    // Users lists `count` files after its three entries, named by `toName(index)`.
    function addUsersFiles(count, toName) {
      mockLaterUsersEntries().push(...Array.from({ length: count }, (_, index) => {
        const name = toName(index);
        return { name, path: `C:\\Users\\${name}`, is_dir: false };
      }));
    }

    // The element each droppable was last rendered into, by id.
    function recordDroppableNodes() {
      const nodeById = new Map();
      useDroppable.mockImplementation(({ id }) => ({
        isOver: false,
        setNodeRef: (node) => {
          if (node) nodeById.set(id, node);
        },
      }));
      return nodeById;
    }

    it("takes drops on any line of an opened folder's long run, each line a droppable of its own, and none while the move runs", async () => {
      // At 128 px, u01..u16 are 4 lines of 4 in one run. As one droppable, a run taller than the
      // pane would lose to the pane's (pointerWithin prefers the rect whose corners are nearest).
      addUsersFiles(16, (index) => `u${String(index + 1).padStart(2, "0")}`);
      const moveGate = Promise.withResolvers();
      const baseInvoke = invoke.getMockImplementation();
      invoke.mockImplementation(async (command, payload) => {
        if (command === "move_path") await moveGate.promise;
        return baseInvoke(command, payload);
      });
      const droppableNodeById = recordDroppableNodes();
      renderFoldableGrid({ thumbnailSizePx: 128, expandedPaths: ["C:\\Users"] }, { paneId: "pane-foldable-long" });
      const run = getTileRun(await screen.findByRole("button", { name: "u01" }));
      const usersRow = screen.getByRole("button", { name: /^Users/ });

      const lineIds = [0, 1, 2, 3].map((index) => `foldable-run:pane-foldable-long:tiles:1:C:\\Users:1:${index}`);
      expect(run.querySelectorAll("[class*='tileRunLine']")).toHaveLength(4);
      lineIds.forEach((id, index) => {
        expect(run).toContainElement(droppableNodeById.get(id));
        expect(droppableNodeById.get(id).style.getPropertyValue("--line-index")).toBe(String(index));
      });
      const getLineOptions = (id) => useDroppable.mock.calls.map(([options]) => options).findLast((options) => options.id === id);
      const thirdLine = getLineOptions(lineIds[2]);
      expect(thirdLine).toEqual({
        id: lineIds[2],
        disabled: false,
        data: { kind: "folder-run", path: "C:\\Users", isDirectory: true, paneId: "pane-foldable-long" },
      });

      const overThirdLine = { id: thirdLine.id, data: { current: thirdLine.data } };
      dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\notes.txt" } });
      dndCallbacks.onDragOver?.({ active: { id: "entry:C:\\notes.txt" }, over: overThirdLine });
      await waitFor(() => {
        expect(run.className).toMatch(/tileRunDropTarget/);
      });
      expect(usersRow.className).toMatch(/dropTarget/);

      await dndCallbacks.onDragEnd?.({ active: { id: "entry:C:\\notes.txt" }, over: overThirdLine });
      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
          source: "C:\\notes.txt",
          destinationDir: "C:\\Users",
        }));
      });

      // Like the rest of the pane, the lines take no drops until the move is done.
      await waitFor(() => {
        expect(lineIds.map((id) => getLineOptions(id).disabled)).toEqual([true, true, true, true]);
      });
      await act(async () => {
        moveGate.resolve();
      });
      await waitFor(() => {
        expect(lineIds.map((id) => getLineOptions(id).disabled)).toEqual([false, false, false, false]);
      });
    });

    it("lays an opened folder's line droppables over its lines of tiles, at its own line height", async () => {
      // At 128 px, u1..u9 are lines of 4, 4 and 1 in Users, whose 134 px tiles fill the 560 px one
      // level in, on lines shorter than the root's.
      addUsersFiles(9, (index) => `u${index + 1}`);
      renderFoldableGrid({ thumbnailSizePx: 128, expandedPaths: ["C:\\Users"] });
      const run = getTileRun(await screen.findByRole("button", { name: "u1" }));
      const lineDroppables = Array.from(run.querySelectorAll("[class*='tileRunLine']"));
      const cellGrid = run.querySelector("[class*='tileCells']");

      // Droppable i is one line tall and i lines down; so is row i of the cells' grid.
      expect(lineDroppables.map((element) => element.style.getPropertyValue("--line-index"))).toEqual(["0", "1", "2"]);
      [...lineDroppables, cellGrid].forEach((element) => {
        expect(getComputedStyle(element).getPropertyValue("--tile-line-height")).toBe("164px");
      });
    });

    it("keeps a line's droppable, and its id, while the window slides through the run", async () => {
      // 240 files in Users, 60 lines of 4 at 128 px: enough for the window.
      addUsersFiles(240, (index) => `u${String(index).padStart(3, "0")}`);
      const droppableNodeById = recordDroppableNodes();
      renderFoldableGrid({ thumbnailSizePx: 128, expandedPaths: ["C:\\Users"] }, { paneId: "pane-foldable-slide" });
      await screen.findByRole("button", { name: "u000" });
      const lineId = (indexInRun) => `foldable-run:pane-foldable-slide:tiles:1:C:\\Users:1:${indexInRun}`;

      // Users' lines are 164 px tall, not the root's 170 px: its 134 px tiles fill the 560 px one
      // level in. Its run starts 260 px down, below 32 px rows and todo.txt's line. Scrolled to its
      // line 30, the window starts 10 lines earlier: line 20 (u080..u083) is the first rendered,
      // below a spacer for the lines above it.
      const scrollContainer = screen.getByTestId("filesystem-panel-scroll-container");
      scrollContainer.scrollTop = 260 + 30 * 164;
      fireEvent.scroll(scrollContainer);
      const run = getTileRun(await screen.findByRole("button", { name: "u080" }));
      expect(screen.queryByRole("button", { name: "u079" })).not.toBeInTheDocument();
      expect(run.previousElementSibling.style.height).toBe(`${260 + 20 * 164}px`);
      const line22 = droppableNodeById.get(lineId(22));
      expect(run).toContainElement(line22);
      expect(line22.style.getPropertyValue("--line-index")).toBe("2");

      // One line further down, line 22 is the second rendered: the same droppable, moved up.
      scrollContainer.scrollTop += 164;
      fireEvent.scroll(scrollContainer);
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "u080" })).not.toBeInTheDocument();
      });
      expect(droppableNodeById.get(lineId(22))).toBe(line22);
      expect(line22.style.getPropertyValue("--line-index")).toBe("1");
    });

    it("drops into the current folder from the top level's empty space", async () => {
      renderFoldableGrid({ expandedPaths: ["C:\\Users"] });
      await screen.findByRole("button", { name: "todo.txt" });

      dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\Users\\todo.txt" } });
      await dndCallbacks.onDragEnd?.({
        active: { id: "entry:C:\\Users\\todo.txt" },
        over: { id: "panel:C:\\" },
      });

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("move_path", expect.objectContaining({
          source: "C:\\Users\\todo.txt",
          destinationDir: "C:\\",
        }));
      });
    });

    it("imports from Explorer into the opened folder whose empty space the files are dropped on, and into the current folder at the top level", async () => {
      renderFoldableGrid({ expandedPaths: ["C:\\Users"] });
      const todoTile = await screen.findByRole("button", { name: "todo.txt" });
      await waitFor(() => {
        expect(typeof externalDropCallback).toBe("function");
      });
      screen.getByLabelText("Filesystem panel").getBoundingClientRect = () => ({
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
      const usersRun = getTileRun(todoTile);
      const rootRun = getTileRun(screen.getByRole("button", { name: "notes.txt" }));
      const position = { x: 100, y: 100 };
      const originalElementFromPoint = document.elementFromPoint;
      document.elementFromPoint = vi.fn(() => usersRun);
      try {
        await externalDropCallback({ payload: { type: "over", paths: [], position } });
        await waitFor(() => {
          expect(usersRun.className).toMatch(/tileRunDropTarget/);
        });
        expect(screen.getByRole("button", { name: /^Users/ }).className).toMatch(/dropTarget/);
        await externalDropCallback({ payload: { type: "drop", paths: ["D:\\Downloads\\clip.mp4"], position } });
        await waitFor(() => {
          expect(invoke).toHaveBeenCalledWith("import_paths", expect.objectContaining({
            paths: ["D:\\Downloads\\clip.mp4"],
            destinationDir: "C:\\Users",
          }));
        });

        document.elementFromPoint = vi.fn(() => rootRun);
        await externalDropCallback({ payload: { type: "drop", paths: ["D:\\Downloads\\photo.jpg"], position } });
        await waitFor(() => {
          expect(invoke).toHaveBeenCalledWith("import_paths", expect.objectContaining({
            paths: ["D:\\Downloads\\photo.jpg"],
            destinationDir: "C:\\",
          }));
        });
      } finally {
        document.elementFromPoint = originalElementFromPoint;
      }
    });

    it("treats clicks and right-clicks between an opened folder's tiles as the pane's empty space", async () => {
      renderFoldableGrid({ expandedPaths: ["C:\\Users"] });
      const todoTile = await screen.findByRole("button", { name: "todo.txt" });
      const usersRun = getTileRun(todoTile);
      // No menu boundary of its own: a right-click there opens the current folder's menu.
      expect(usersRun).not.toHaveAttribute("data-contextmenu-boundary");

      fireEvent.click(todoTile);
      fireEvent.click(usersRun);
      expect(getShownSelection()).toEqual([]);

      fireEvent.click(todoTile);
      fireEvent.contextMenu(usersRun);
      expect(getShownSelection()).toEqual([]);
    });
  });
});
