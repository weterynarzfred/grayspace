import { act, render, screen, waitFor } from "@testing-library/react";
import PanelsDndLayer from "../PanelsDndLayer";
import PropertiesPanel from "./PropertiesPanel";

const dndCallbacks = {
  onDragStart: undefined,
  onDragEnd: undefined,
  onDragCancel: undefined,
};

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

describe("PropertiesPanel", () => {
  beforeEach(() => {
    dndCallbacks.onDragStart = undefined;
    dndCallbacks.onDragEnd = undefined;
    dndCallbacks.onDragCancel = undefined;
  });

  it("locks to the first dropped path", async () => {
    render(
      <PanelsDndLayer>
        <PropertiesPanel
          paneId="properties-pane"
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
          id: "properties-drop:properties-pane",
        },
      });
    });

    expect(screen.getByRole("button", { name: /^unlock$/i })).toBeInTheDocument();
    expect(screen.getByText("notes.txt").tagName).toBe("P");
  });
});
