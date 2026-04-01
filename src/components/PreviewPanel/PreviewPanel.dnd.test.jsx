import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import PanelsDndLayer from "../PanelsDndLayer";
import PreviewPanel from "./PreviewPanel";
import { runInAct, runInAsyncAct } from "../../test/utils/actCallbacks";

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

describe("PreviewPanel drag and drop", () => {
  beforeEach(() => {
    externalDropCallback = undefined;
    dndCallbacks.onDragStart = undefined;
    dndCallbacks.onDragEnd = undefined;
    dndCallbacks.onDragCancel = undefined;
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

  it("locks and loads the first dropped path", async () => {
    render(
      <PanelsDndLayer>
        <PreviewPanel
          paneId="preview-pane"
          tabSelectedFiles={{
            selectedPaths: [],
          }}
        />
      </PanelsDndLayer>,
    );

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

    expect(screen.getByRole("button", { name: /^unlock$/i })).toBeInTheDocument();
  });

  it("loads dropped external paths", async () => {
    render(
      <PanelsDndLayer>
        <PreviewPanel
          paneId="preview-pane"
          tabSelectedFiles={{
            selectedPaths: [],
          }}
        />
      </PanelsDndLayer>,
    );

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
    expect(screen.getByRole("button", { name: /^unlock$/i })).toBeInTheDocument();
  });
});
