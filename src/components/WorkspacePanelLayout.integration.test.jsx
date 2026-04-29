import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import PanelsDndLayer from "./PanelsDndLayer";
import WorkspacePanelLayout from "./WorkspacePanelLayout";
import { getPaneIdsInLayoutOrder } from "./workspacePanelLayoutUtils";
import { NotificationCenterProvider } from "../notifications/notificationCenter";
import {
  closePreviewTab,
  openPathInPreviewPaneState,
  setActivePreviewTab,
  updatePreviewTab,
} from "./PreviewPanel/previewPaneState";

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

function resolvePreviewPaneIdForTab(tab) {
  const paneStates = tab?.paneStates ?? {};
  const activePaneId = tab?.activePaneId ?? "";
  if (paneStates[activePaneId]?.panelType === "Preview") return activePaneId;

  const paneIdsInLayoutOrder = getPaneIdsInLayoutOrder(tab?.layout);
  const firstPreviewPaneId = paneIdsInLayoutOrder.find((paneId) => (
    paneStates[paneId]?.panelType === "Preview"
  ));
  if (firstPreviewPaneId) return firstPreviewPaneId;

  return Object.keys(paneStates).find((paneId) => paneStates[paneId]?.panelType === "Preview")
    ?? "";
}

function resolveSelectedFilePath(selectedFiles = {}) {
  const selectedPaths = Array.isArray(selectedFiles?.selectedPaths)
    ? selectedFiles.selectedPaths
    : [];
  const selectedEntryKinds = selectedFiles?.selectedEntryKinds ?? {};
  return selectedPaths.find((path) => selectedEntryKinds[path] === "file") ?? "";
}

function WorkspacePanelLayoutHarness() {
  const [tab, setTab] = useState(createInitialTabState);
  const [previewPaneStateById, setPreviewPaneStateById] = useState({});
  const paneIdsInLayoutOrder = getPaneIdsInLayoutOrder(tab.layout);
  const primaryFilesystemPaneId = paneIdsInLayoutOrder.find(
    (paneId) => tab.paneStates[paneId]?.panelType === "Filesystem",
  ) ?? "";

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
    if (panelType !== "Preview") {
      setPreviewPaneStateById((previousState) => {
        if (!(paneId in previousState)) return previousState;
        const nextState = { ...previousState };
        delete nextState[paneId];
        return nextState;
      });
    }
  }

  function updatePreviewPaneState(paneId, updater) {
    if (!paneId || typeof updater !== "function") return;
    setPreviewPaneStateById((previousState) => {
      const currentPaneState = previousState[paneId];
      const nextPaneState = updater(currentPaneState);
      if (!nextPaneState || !Array.isArray(nextPaneState.tabs) || nextPaneState.tabs.length === 0) {
        if (!(paneId in previousState)) return previousState;
        const nextState = { ...previousState };
        delete nextState[paneId];
        return nextState;
      }
      return {
        ...previousState,
        [paneId]: nextPaneState,
      };
    });
  }

  return (
    <>
      <button type="button" onClick={() => setPanelType("tab-integration-left", "Preview")}>
        set-left-preview
      </button>
      <button type="button" onClick={() => setPanelType("tab-integration-left", "Canvas")}>
        set-left-canvas
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
          previewPaneStateById={previewPaneStateById}
          primaryFilesystemPaneId={primaryFilesystemPaneId}
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

            const selectedFilePath = resolveSelectedFilePath(selectedFiles);
            if (!selectedFilePath) return;
            const targetPreviewPaneId = resolvePreviewPaneIdForTab(tab);
            if (!targetPreviewPaneId) return;

            updatePreviewPaneState(targetPreviewPaneId, (paneState) => (
              openPathInPreviewPaneState(paneState, selectedFilePath, {
                openAsEphemeral: selectedFiles?.previewOpenMode !== "pinned",
              })
            ));
          }}
          onOpenPreviewPath={(tabId, paneId, path, options = {}) => {
            if (!tabId || !paneId || !path) return;
            updatePreviewPaneState(paneId, paneState => openPathInPreviewPaneState(
              paneState,
              path,
              { openAsEphemeral: options?.openMode !== "pinned" },
            ));
          }}
          onActivatePreviewTab={(tabId, paneId, path) => {
            if (!tabId || !paneId || !path) return;
            updatePreviewPaneState(paneId, paneState => setActivePreviewTab(paneState, path));
          }}
          onClosePreviewTab={(tabId, paneId, path) => {
            if (!tabId || !paneId || !path) return;
            updatePreviewPaneState(paneId, paneState => closePreviewTab(paneState, path));
          }}
          onUpdatePreviewTab={(tabId, paneId, path, patch = {}) => {
            if (!tabId || !paneId || !path) return;
            updatePreviewPaneState(paneId, paneState => updatePreviewTab(paneState, path, patch));
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

      if (command === "list_directory_page") {
        let entries = [];
        if (payload?.path === "C:\\") {
          entries = [
            { name: "Users", path: "C:\\Users", is_dir: true },
            { name: "notes.txt", path: "C:\\notes.txt", is_dir: false },
            { name: "draft.md", path: "C:\\draft.md", is_dir: false },
          ];
        }
        const offset = payload?.offset ?? 0;
        const limit = payload?.limit ?? entries.length;
        const pageEntries = entries.slice(offset, offset + limit);
        return {
          entries: pageEntries,
          hasMore: offset + pageEntries.length < entries.length,
          totalCount: entries.length,
        };
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

  it("keeps preview tabs scoped to each preview pane", async () => {
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
      expect(within(previewPanels[0]).getByRole("tab", { name: "notes.txt" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "set-left-preview" }));
    await waitFor(() => {
      const previewPanels = screen.getAllByLabelText("Preview panel");
      expect(previewPanels).toHaveLength(2);
      expect(within(previewPanels[0]).getByText("Select a file to preview.")).toBeInTheDocument();
      expect(within(previewPanels[1]).getByRole("tab", { name: "notes.txt" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "set-right-filesystem" }));
    await waitFor(() => {
      const previewPanels = screen.getAllByLabelText("Preview panel");
      expect(previewPanels).toHaveLength(1);
      expect(within(previewPanels[0]).getByText("Select a file to preview.")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Filesystem panel")).toBeInTheDocument();
    expect(await screen.findByText("Select a drive")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "set-left-canvas" }));
    fireEvent.click(screen.getByRole("button", { name: "set-right-canvas" }));
    expect((await screen.findAllByText("Canvas panel")).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByLabelText("Preview panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "set-right-preview" }));
    await waitFor(() => {
      const previewPanels = screen.getAllByLabelText("Preview panel");
      expect(previewPanels).toHaveLength(1);
      expect(within(previewPanels[0]).getByText("Select a file to preview.")).toBeInTheDocument();
    });
  });
});

