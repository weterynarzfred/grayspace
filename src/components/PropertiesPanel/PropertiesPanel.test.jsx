import { act, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
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

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("PropertiesPanel", () => {
  beforeEach(() => {
    dndCallbacks.onDragStart = undefined;
    dndCallbacks.onDragEnd = undefined;
    dndCallbacks.onDragCancel = undefined;
    invoke.mockReset();
    invoke.mockImplementation(async (command, payload) => {
      if (command !== "filesystem_get_properties") {
        throw new Error(`Unhandled invoke command: ${command}`);
      }

      return {
        path: payload?.path || "",
        sizeBytes: 4096,
        entryType: "TXT file",
        dateModifiedMs: 1700000000000,
        dateCreatedMs: 1690000000000,
      };
    });
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
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("filesystem_get_properties", { path: "C:\\notes.txt" });
    });
  });

  it("shows size, type and file dates", async () => {
    render(
      <PanelsDndLayer>
        <PropertiesPanel
          paneId="properties-pane"
          tabSelectedFiles={{
            selectedPaths: ["C:\\notes.txt"],
          }}
        />
      </PanelsDndLayer>,
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("filesystem_get_properties", { path: "C:\\notes.txt" });
    });

    expect(screen.getByText("size")).toBeInTheDocument();
    expect(screen.getByText("type")).toBeInTheDocument();
    expect(screen.getByText("date modified")).toBeInTheDocument();
    expect(screen.getByText("date created")).toBeInTheDocument();
    expect(screen.getByText("4 KB")).toBeInTheDocument();
    expect(screen.getByText("TXT file")).toBeInTheDocument();
  });
});
