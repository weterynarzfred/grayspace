import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import PanelsDndLayer from "../PanelsDndLayer";
import FilesystemPanel from "./FilesystemPanel";

const dndCallbacks = {
  onDragStart: undefined,
  onDragEnd: undefined,
  onDragCancel: undefined,
};
let externalDropCallback;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: vi.fn(async (handler) => {
      externalDropCallback = handler;
      return () => {
        externalDropCallback = undefined;
      };
    }),
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
  PointerSensor: class {},
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

describe("FilesystemPanel", () => {
  beforeEach(() => {
    externalDropCallback = undefined;
    dndCallbacks.onDragStart = undefined;
    dndCallbacks.onDragEnd = undefined;
    dndCallbacks.onDragCancel = undefined;

    const directoryState = {
      "C:\\": [
        { name: "Users", path: "C:\\Users", is_dir: true },
        { name: "notes.txt", path: "C:\\notes.txt", is_dir: false },
        { name: "draft.md", path: "C:\\draft.md", is_dir: false },
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

    expect(await screen.findByText("Files")).toBeInTheDocument();
    expect(await screen.findByText("Users")).toBeInTheDocument();
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText("..")).toBeInTheDocument();
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
    expect(screen.getByText("Drives")).toBeInTheDocument();
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

    expect(await screen.findByText("Files")).toBeInTheDocument();

    const drivesCrumb = await screen.findByRole("button", { name: "Drives" });
    fireEvent.click(drivesCrumb);

    expect(await screen.findByText("Select a drive")).toBeInTheDocument();
    expect(screen.getByText("Drives")).toBeInTheDocument();
  });

  it("hydrates filesystem state and restores scroll per pane", async () => {
    const onFilesystemStateChange = vi.fn();
    renderFilesystemPanel({
      tabId: "tab-1",
      pane: "left",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\Users",
        selectedPath: "C:\\Users\\todo.txt",
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
      pane: "left",
      filesystemState: {
        currentDrive: "C:\\",
        currentPath: "C:\\",
        selectedPath: "",
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
});
