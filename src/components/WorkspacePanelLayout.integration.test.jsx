import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import PanelsDndLayer from "./PanelsDndLayer";
import WorkspacePanelLayout from "./WorkspacePanelLayout";
import { NotificationCenterProvider } from "../notifications/notificationCenter";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  cursorPosition: vi.fn(async () => ({ x: 100, y: 100 })),
  getCurrentWindow: () => ({
    onDragDropEvent: vi.fn(async () => () => {}),
    innerPosition: vi.fn(async () => ({ x: 0, y: 0 })),
    innerSize: vi.fn(async () => ({ width: 500, height: 500 })),
  }),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }) => <>{children}</>,
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

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }) => <div>{children}</div>,
  Panel: ({ children }) => <div>{children}</div>,
  Separator: (props) => <div {...props} />,
}));

vi.mock("./PreviewPanel/CodeTextPreview", () => ({
  default: ({ content }) => <div data-testid="preview-text-content">{content}</div>,
}));

function createInitialTabState() {
  return {
    tabId: "tab-integration",
    layout: {
      kind: "split",
      axis: "row",
      ratio: 50,
      first: {
        kind: "leaf",
        paneId: "tab-integration-left",
      },
      second: {
        kind: "leaf",
        paneId: "tab-integration-right",
      },
    },
    activePaneId: "tab-integration-left",
    selectedFiles: {
      selectedPaths: [],
    },
    paneStates: {
      "tab-integration-left": {
        paneId: "tab-integration-left",
        panelType: "Filesystem",
        terminalSessionId: "term-left",
        filesystemState: {
          currentDrive: "",
          currentPath: "",
          selectedPaths: [],
          scrollTop: 0,
        },
      },
      "tab-integration-right": {
        paneId: "tab-integration-right",
        panelType: "Preview",
        terminalSessionId: "term-right",
        filesystemState: {
          currentDrive: "",
          currentPath: "",
          selectedPaths: [],
          scrollTop: 0,
        },
      },
    },
  };
}

function WorkspacePanelLayoutHarness() {
  const [tab, setTab] = useState(createInitialTabState);

  function setPanelType(paneId, panelType) {
    setTab((previousTab) => ({
      ...previousTab,
      paneStates: {
        ...previousTab.paneStates,
        [paneId]: {
          ...previousTab.paneStates[paneId],
          panelType,
        },
      },
    }));
  }

  return (
    <>
      <button type="button" onClick={() => setPanelType("tab-integration-left", "Preview")}>
        set-left-preview
      </button>
      <button type="button" onClick={() => setPanelType("tab-integration-left", "Scripts")}>
        set-left-scripts
      </button>
      <button type="button" onClick={() => setPanelType("tab-integration-right", "Filesystem")}>
        set-right-filesystem
      </button>
      <button type="button" onClick={() => setPanelType("tab-integration-right", "Canvas")}>
        set-right-canvas
      </button>
      <button type="button" onClick={() => setPanelType("tab-integration-right", "Preview")}>
        set-right-preview
      </button>

      <PanelsDndLayer>
        <WorkspacePanelLayout
          tab={tab}
          onPanelTypeChange={(tabId, paneId, panelType) => {
            if (!tabId || !paneId || !panelType) return;
            setPanelType(paneId, panelType);
          }}
          onFilesystemStateChange={(tabId, paneId, filesystemState) => {
            if (!tabId || !paneId || !filesystemState) return;
            setTab((previousTab) => ({
              ...previousTab,
              paneStates: {
                ...previousTab.paneStates,
                [paneId]: {
                  ...previousTab.paneStates[paneId],
                  filesystemState,
                },
              },
            }));
          }}
          onTabSelectedFilesChange={(tabId, selectedFiles) => {
            if (!tabId || !selectedFiles) return;
            setTab((previousTab) => ({
              ...previousTab,
              selectedFiles,
            }));
          }}
        />
      </PanelsDndLayer>
    </>
  );
}

describe("WorkspacePanelLayout integration", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives") {
        return [{ name: "C:", path: "C:\\" }];
      }

      if (command === "list_directory") {
        if (payload?.path === "C:\\") {
          return [
            { name: "Users", path: "C:\\Users", is_dir: true },
            { name: "notes.txt", path: "C:\\notes.txt", is_dir: false },
            { name: "draft.md", path: "C:\\draft.md", is_dir: false },
          ];
        }
        return [];
      }

      if (command === "parent_path") {
        if (payload?.path === "C:\\") return null;
        return "C:\\";
      }

      if (command === "open_path") {
        return null;
      }

      if (command === "start_external_drag") {
        return null;
      }

      if (command === "thumbnail_resolve_batch") {
        const items = payload?.request?.items ?? [];
        return {
          results: items.map((item, index) => ({
            sourcePath: item?.sourcePath ?? "",
            bucketPx: 64,
            key: `thumb-wpl-${index}`,
            status: "pending",
            thumbnailPath: null,
            mime: null,
            error: null,
          })),
        };
      }

      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") {
        return null;
      }

      if (command === "workspace_read_folder_config" || command === "terminal_run_command") {
        return null;
      }

      if (command === "preview_read_file") {
        return {
          kind: "text",
          content: "mock preview",
          truncated: false,
        };
      }

      if (command === "preview_write_text_file") {
        return null;
      }

      if (command === "move_path" || command === "import_paths") {
        return null;
      }

      throw new Error(`Unhandled invoke command: ${command}`);
    });
  });

  it("keeps last selected file across panel switching flow", async () => {
    render(
      <NotificationCenterProvider>
        <WorkspacePanelLayoutHarness />
      </NotificationCenterProvider>,
    );

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.doubleClick(driveButton);

    const fileButton = await screen.findByRole("button", { name: /notes\.txt/i });
    fireEvent.click(fileButton);

    await waitFor(() => {
      const previewPanels = screen.getAllByLabelText("Preview panel");
      expect(previewPanels).toHaveLength(1);
      expect(within(previewPanels[0]).getByText("notes.txt")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "set-left-preview" }));
    await waitFor(() => {
      const previewPanels = screen.getAllByLabelText("Preview panel");
      expect(previewPanels).toHaveLength(2);
      previewPanels.forEach((panel) => {
        expect(within(panel).getByText("notes.txt")).toBeInTheDocument();
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "set-right-filesystem" }));
    await waitFor(() => {
      const previewPanels = screen.getAllByLabelText("Preview panel");
      expect(previewPanels).toHaveLength(1);
      expect(within(previewPanels[0]).getByText("notes.txt")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Filesystem panel")).toBeInTheDocument();
    expect(await screen.findByText("Select a drive")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "set-left-scripts" }));
    fireEvent.click(screen.getByRole("button", { name: "set-right-canvas" }));
    expect(await screen.findByText("Scripts panel")).toBeInTheDocument();
    expect(await screen.findByText("Canvas panel")).toBeInTheDocument();
    expect(screen.queryByLabelText("Preview panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "set-right-preview" }));
    await waitFor(() => {
      const previewPanels = screen.getAllByLabelText("Preview panel");
      expect(previewPanels).toHaveLength(1);
      expect(within(previewPanels[0]).getByText("notes.txt")).toBeInTheDocument();
    });
  });
});

