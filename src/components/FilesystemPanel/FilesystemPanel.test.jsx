import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import FilesystemPanel from "./FilesystemPanel";

const dndCallbacks = {
  onDragStart: undefined,
  onDragEnd: undefined,
  onDragCancel: undefined,
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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

describe("FilesystemPanel", () => {
  beforeEach(() => {
    dndCallbacks.onDragStart = undefined;
    dndCallbacks.onDragEnd = undefined;
    dndCallbacks.onDragCancel = undefined;

    const directoryState = {
      "C:\\": [
        { name: "Users", path: "C:\\Users", is_dir: true },
        { name: "notes.txt", path: "C:\\notes.txt", is_dir: false },
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

      throw new Error(`Unhandled invoke: ${command}`);
    });
  });

  it("loads and shows available drives", async () => {
    render(<FilesystemPanel />);

    expect(screen.getByText("Loading drives...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("C:")).toBeInTheDocument();
    });
  });

  it("navigates into a selected drive and lists entries", async () => {
    render(<FilesystemPanel />);

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    expect(await screen.findByText("Files")).toBeInTheDocument();
    expect(await screen.findByText("Users")).toBeInTheDocument();
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText("..")).toBeInTheDocument();
  });

  it("uses breadcrumbs to jump back to a parent path", async () => {
    render(<FilesystemPanel />);

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
    render(<FilesystemPanel />);

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.click(driveButton);

    expect(driveButton).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Drives")).toBeInTheDocument();
    expect(screen.getByText("Select a drive")).toBeInTheDocument();
  });

  it("single click selects folders and files", async () => {
    render(<FilesystemPanel />);

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

  it("opens a file on double click", async () => {
    render(<FilesystemPanel />);

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const fileButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.doubleClick(fileButton);

    expect(invoke).toHaveBeenCalledWith("open_path", { path: "C:\\notes.txt" });
  });

  it("moves an entry when dropped onto a folder", async () => {
    render(<FilesystemPanel />);

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

  it("does not move an entry when dropped onto itself", async () => {
    render(<FilesystemPanel />);

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
    render(<FilesystemPanel />);

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
    render(<FilesystemPanel />);

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
    render(<FilesystemPanel />);

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
    render(<FilesystemPanel />);

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    expect(await screen.findByText("Files")).toBeInTheDocument();

    const drivesCrumb = await screen.findByRole("button", { name: "Drives" });
    fireEvent.click(drivesCrumb);

    expect(await screen.findByText("Select a drive")).toBeInTheDocument();
    expect(screen.getByText("Drives")).toBeInTheDocument();
  });
});
