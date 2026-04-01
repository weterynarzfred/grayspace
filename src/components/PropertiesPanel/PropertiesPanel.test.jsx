import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import PanelsDndLayer from "../PanelsDndLayer";
import PropertiesPanel from "./PropertiesPanel";
import { runInAct, runInAsyncAct } from "../../test/utils/actCallbacks";
import { advanceTimersBy } from "../../test/utils/timers";

const dndCallbacks = {
  onDragStart: undefined,
  onDragEnd: undefined,
  onDragCancel: undefined,
};
let externalDropCallback;
let filesystemWatchCallback;

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
  listen: vi.fn(async (eventName, handler) => {
    if (eventName === "filesystem-watch-event") filesystemWatchCallback = runInAsyncAct(handler);
    return () => {
      filesystemWatchCallback = undefined;
    };
  }),
}));

describe("PropertiesPanel", () => {
  beforeEach(() => {
    externalDropCallback = undefined;
    dndCallbacks.onDragStart = undefined;
    dndCallbacks.onDragEnd = undefined;
    dndCallbacks.onDragCancel = undefined;
    filesystemWatchCallback = undefined;
    invoke.mockReset();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
        return null;

      if (command !== "filesystem_get_properties")
        throw new Error(`Unhandled invoke command: ${command}`);

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
        id: "properties-drop:properties-pane",
      },
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

  it("reloads properties when watcher emits a matching file change", async () => {
    let revision = 1;
    invoke.mockImplementation(async (command, payload) => {
      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop")
        return null;

      if (command !== "filesystem_get_properties")
        throw new Error(`Unhandled invoke command: ${command}`);

      return {
        path: payload?.path || "",
        sizeBytes: revision++,
        entryType: "TXT file",
        dateModifiedMs: 1700000000000,
        dateCreatedMs: 1690000000000,
      };
    });

    render(
      <PanelsDndLayer>
        <PropertiesPanel
          tabSelectedFiles={{
            selectedPaths: ["C:\\notes.txt"],
          }}
        />
      </PanelsDndLayer>,
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("filesystem_get_properties", { path: "C:\\notes.txt" });
    });

    let watchId = "";
    await waitFor(() => {
      const watchStartCall = [...invoke.mock.calls].reverse().find(([command, args]) => (
        command === "filesystem_watch_start" && args?.path === "C:\\"
      ));
      watchId = watchStartCall?.[1]?.watchId ?? "";
      expect(watchId).toBeTruthy();
      expect(typeof filesystemWatchCallback).toBe("function");
    });

    vi.useFakeTimers();
    try {
      await filesystemWatchCallback?.({
        payload: {
          watchId,
          changedPath: "C:\\notes.txt",
        },
      });
      await advanceTimersBy(180);
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(
        invoke.mock.calls.filter(([command, args]) => (
          command === "filesystem_get_properties" && args?.path === "C:\\notes.txt"
        )),
      ).toHaveLength(2);
    });
  });

  it("loads dropped external path into properties panel", async () => {
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
      expect(typeof externalDropCallback).toBe("function");
    });

    const panel = screen.getByLabelText("Properties panel");
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
      expect(invoke).toHaveBeenCalledWith("filesystem_get_properties", { path: "C:\\notes.txt" });
    });
  });
});
