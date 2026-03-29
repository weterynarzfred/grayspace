import { act, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import PanelsDndLayer from "../PanelsDndLayer";
import PreviewPanel from "./PreviewPanel";

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
  PointerSensor: class {},
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
    dndCallbacks.onDragStart = undefined;
    dndCallbacks.onDragEnd = undefined;
    dndCallbacks.onDragCancel = undefined;
    invoke.mockReset();
    invoke.mockImplementation(async (command, payload) => {
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

    await act(async () => {
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
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("preview_read_file", {
        path: "C:\\notes.txt",
      });
    });

    expect(screen.getByRole("button", { name: /^unlock$/i })).toBeInTheDocument();
  });
});
