import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import PanelsDndLayer from "../PanelsDndLayer";
import PreviewPanel from "./PreviewPanel";
import {
  normalizePreviewPaneState,
  openPathInPreviewPaneState,
  setActivePreviewTab,
  closePreviewTab,
  updatePreviewTab,
} from "./previewPaneState";
import { runInAct, runInAsyncAct } from "../../test/utils/actCallbacks";

const dndCallbacks = {
  onDragStart: undefined,
  onDragEnd: undefined,
  onDragCancel: undefined,
};
let externalDropCallback;
const openConfirmMock = vi.fn(async () => true);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: vi.fn(async (handler) => {
      externalDropCallback = runInAsyncAct(handler);
      return () => {
        externalDropCallback = undefined;
      };
    }),
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => { }),
}));

vi.mock("../../notifications/notificationCenter", () => ({
  useNotificationCenter: () => ({
    openConfirm: openConfirmMock,
  }),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragStart, onDragEnd, onDragCancel }) => {
    dndCallbacks.onDragStart = runInAct(onDragStart);
    dndCallbacks.onDragEnd = runInAsyncAct(onDragEnd);
    dndCallbacks.onDragCancel = runInAct(onDragCancel);
    return <>{children}</>;
  },
  PointerSensor: class { },
  pointerWithin: vi.fn(() => []),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn((...sensors) => sensors),
  useDroppable: vi.fn(() => ({
    isOver: false,
    setNodeRef: vi.fn(),
  })),
}));

vi.mock("./CodeTextPreview", () => ({
  default: ({ content }) => <div data-testid="preview-text-content">{content}</div>,
}));

function PreviewPanelHarness() {
  const [paneState, setPaneState] = useState(
    normalizePreviewPaneState({ tabs: [], activePath: "" }),
  );

  return (
    <PanelsDndLayer>
      <PreviewPanel
        paneId="preview-pane"
        previewPaneState={paneState}
        onOpenPreviewPath={(path, options = {}) => {
          setPaneState(previous => openPathInPreviewPaneState(previous, path, {
            openAsEphemeral: options?.openMode !== "pinned",
          }));
        }}
        onActivatePreviewTab={(path) => {
          setPaneState(previous => setActivePreviewTab(previous, path));
        }}
        onClosePreviewTab={(path) => {
          setPaneState(previous => closePreviewTab(previous, path));
        }}
        onUpdatePreviewTab={(path, patch = {}) => {
          setPaneState(previous => updatePreviewTab(previous, path, patch));
        }}
      />
    </PanelsDndLayer>
  );
}

describe("PreviewPanel drag and drop", () => {
  beforeEach(() => {
    externalDropCallback = undefined;
    dndCallbacks.onDragStart = undefined;
    dndCallbacks.onDragEnd = undefined;
    dndCallbacks.onDragCancel = undefined;
    openConfirmMock.mockReset();
    openConfirmMock.mockResolvedValue(true);
    invoke.mockReset();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
        return null;

      if (command === "preview_read_file") {
        return {
          kind: "text",
          content: `preview:${payload?.path ?? ""}`,
          truncated: false,
        };
      }

      throw new Error(`Unhandled invoke: ${command}`);
    });
  });

  it("loads the first dropped path from internal panel drag", async () => {
    render(<PreviewPanelHarness />);

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
    });

    dndCallbacks.onDragStart?.({
      active: {
        id: "entry:C:\\notes.txt",
        data: {
          current: {
            sourcePath: "C:\\notes.txt",
            dragPaths: ["C:\\notes.txt", "C:\\other.txt"],
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
            dragPaths: ["C:\\notes.txt", "C:\\other.txt"],
          },
        },
      },
      over: {
        id: "preview-drop:preview-pane",
      },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("preview_read_file", {
        path: "C:\\notes.txt",
      });
    });

    const tabButton = screen.getByRole("tab", { name: "notes.txt" });
    expect(tabButton.getAttribute("title")).not.toContain("ephemeral");
  });

  it("loads dropped external paths", async () => {
    render(<PreviewPanelHarness />);

    await waitFor(() => {
      expect(typeof externalDropCallback).toBe("function");
    });

    const panel = screen.getByLabelText("Preview panel");
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
        paths: ["C:\\notes.txt"],
        position: { x: 100, y: 100 },
      },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("preview_read_file", {
        path: "C:\\notes.txt",
      });
    });
    expect(screen.getByRole("tab", { name: "notes.txt" })).toBeInTheDocument();
  });
});
