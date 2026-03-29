import path from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import PanelsDndLayer from "../PanelsDndLayer";
import FilesystemPanel from "./FilesystemPanel";

const { openConfirmMock } = vi.hoisted(() => ({
  openConfirmMock: vi.fn(),
}));

const dndCallbacks = {
  onDragStart: undefined,
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
    if (eventName === "filesystem-watch-event") {
      filesystemWatchCallback = handler;
    }
    return () => {
      if (filesystemWatchCallback === handler) filesystemWatchCallback = undefined;
    };
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  cursorPosition: vi.fn(async () => ({ x: 100, y: 100 })),
  getCurrentWindow: () => ({
    onDragDropEvent: vi.fn(async (handler) => {
      externalDropCallback = handler;
      return () => {
        externalDropCallback = undefined;
      };
    }),
    innerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
    innerSize: vi.fn(async () => ({ width: 500, height: 500 })),
  }),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragStart, onDragEnd, onDragCancel }) => {
    dndCallbacks.onDragStart = onDragStart;
    dndCallbacks.onDragEnd = onDragEnd;
    dndCallbacks.onDragCancel = onDragCancel;
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
    externalDropCallback = undefined;
    filesystemWatchCallback = undefined;
    dndCallbacks.onDragStart = undefined;
    dndCallbacks.onDragEnd = undefined;
    dndCallbacks.onDragCancel = undefined;
    openConfirmMock.mockReset();
    openConfirmMock.mockResolvedValue(true);

    const directoryState = {
      "C:\\": [
        { name: "Users", path: "C:\\Users", is_dir: true },
        { name: "notes.txt", path: "C:\\notes.txt", is_dir: false },
        { name: "draft.md", path: "C:\\draft.md", is_dir: false },
        { name: ".grayspace", path: "C:\\.grayspace", is_dir: true },
      ],
      "C:\\Users": [
        { name: "Projects", path: "C:\\Users\\Projects", is_dir: true },
        { name: "todo.txt", path: "C:\\Users\\todo.txt", is_dir: false },
      ],
      "C:\\Users\\Projects": [],
    };

    invoke.mockReset();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives") {
        return [{ name: "C:", path: "C:\\" }];
      }

      if (command === "list_directory") {
        const entries = directoryState[payload?.path];
        if (!entries) {
          throw new Error(`Unhandled list_directory path: ${payload?.path}`);
        }
        return entries.map((entry) => ({ ...entry }));
      }

      if (command === "parent_path") {
        if (payload?.path === "C:\\") {
          return null;
        }
        return path.win32.dirname(payload?.path ?? "");
      }

      if (command === "open_path" && payload?.path === "C:\\notes.txt") {
        return null;
      }

      if (command === "move_path") {
        const source = payload?.source;
        const destinationDir = payload?.destinationDir;
        const sourceParent = path.win32.dirname(source ?? "");
        const sourceName = path.win32.basename(source ?? "");
        const sourceEntries = directoryState[sourceParent] ?? [];
        const sourceEntry = sourceEntries.find((entry) => entry.path === source);

        if (!sourceEntry) {
          throw new Error(`Missing source entry for ${source}`);
        }

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

      if (command === "import_paths") {
        const destinationDir = payload?.destinationDir;
        const importPaths = payload?.paths ?? [];
        const destinationEntries = directoryState[destinationDir];
        if (!destinationEntries) {
          throw new Error(`Unhandled import destination path: ${destinationDir}`);
        }

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
              if (directoryKey === deletePath || directoryKey.startsWith(`${deletePath}\\`)) {
                delete directoryState[directoryKey];
              }
            });
          }
        });
        return null;
      }

      if (command === "start_external_drag") {
        return null;
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") {
        return null;
      }

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
    });

    fireEvent.click(fileButton, { ctrlKey: true });
    expect(onTabSelectedFilesChange).toHaveBeenLastCalledWith({
      selectedPaths: [],
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

  it("opens a file on double click", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const fileButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.doubleClick(fileButton);

    expect(invoke).toHaveBeenCalledWith("open_path", { path: "C:\\notes.txt" });
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

  it("does not move an entry when dropped onto a file entry", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
    });

    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\notes.txt" } });
    await dndCallbacks.onDragEnd?.({
      active: { id: "entry:C:\\notes.txt" },
      over: {
        id: "entry:C:\\draft.md",
        data: {
          current: {
            kind: "entry",
            path: "C:\\draft.md",
            isDirectory: false,
          },
        },
      },
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

    dndCallbacks.onDragStart?.({ active: { id: "entry:C:\\notes.txt" } });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    fireEvent.mouseOut(document, { relatedTarget: null });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("start_external_drag", {
        paths: ["C:\\notes.txt"],
      });
    });

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

    expect(await screen.findByRole("button", { name: /Users/i })).toBeInTheDocument();

    const upButton = screen.getByRole("button", { name: /\.\.\s*Up/i });
    fireEvent.click(upButton);

    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();

    fireEvent.doubleClick(upButton);

    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
  });

  it("uses breadcrumb root to return to drive selection", async () => {
    renderFilesystemPanel();

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const drivesCrumb = await screen.findByRole("button", { name: "Drives" });
    fireEvent.click(drivesCrumb);

    expect(await screen.findByText("Select a drive")).toBeInTheDocument();
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

    const panelList = screen.getByTestId("filesystem-panel-list");
    expect(panelList.scrollTop).toBe(37);
  });

  it("persists throttled scroll updates", async () => {
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
    const panelList = screen.getByTestId("filesystem-panel-list");
    panelList.scrollTop = 91;
    fireEvent.scroll(panelList);

    await new Promise((resolve) => {
      setTimeout(resolve, 180);
    });

    await waitFor(() => {
      expect(onFilesystemStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ scrollTop: 91 }),
      );
    });
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

