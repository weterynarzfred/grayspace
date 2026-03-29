import { render, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import PanelsDndLayer from "../PanelsDndLayer";
import TerminalPanel from "./TerminalPanel";

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

vi.mock("./hooks/useTerminalSession", () => ({
  default: () => ({
    terminalHostRef: { current: null },
    status: "",
  }),
}));

describe("TerminalPanel", () => {
  beforeEach(() => {
    dndCallbacks.onDragStart = undefined;
    dndCallbacks.onDragEnd = undefined;
    dndCallbacks.onDragCancel = undefined;
    invoke.mockReset();
    invoke.mockResolvedValue(null);
  });

  it("writes dropped paths into terminal input", async () => {
    render(
      <PanelsDndLayer>
        <TerminalPanel
          paneId="terminal-pane"
          terminalSessionId="term-1"
        />
      </PanelsDndLayer>,
    );

    await waitFor(() => {
      expect(typeof dndCallbacks.onDragEnd).toBe("function");
    });

    await dndCallbacks.onDragEnd?.({
      active: {
        id: "entry:C:\\notes.txt",
        data: {
          current: {
            sourcePath: "C:\\notes.txt",
            dragPaths: ["C:\\notes.txt", "D:\\My Files\\todo.md"],
          },
        },
      },
      over: {
        id: "terminal-drop:terminal-pane",
      },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("terminal_write", {
        sessionId: "term-1",
        data: "'/c/notes.txt' '/d/My Files/todo.md'",
      });
    });
  });
});
