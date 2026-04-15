import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import PanelsDndLayer from "../PanelsDndLayer";
import PreviewPanel from "./PreviewPanel";
import {
  closePreviewTab,
  normalizePreviewPaneState,
  openPathInPreviewPaneState,
  setActivePreviewTab,
  updatePreviewTab,
} from "./previewPaneState";

let filesystemWatchCallback;
const openConfirmMock = vi.fn(async () => true);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path) => `asset://localhost/${encodeURIComponent(path || "")}`),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName, handler) => {
    if (eventName === "filesystem-watch-event") filesystemWatchCallback = handler;
    return () => {
      if (filesystemWatchCallback === handler) filesystemWatchCallback = undefined;
    };
  }),
}));

vi.mock("../../notifications/notificationCenter", () => ({
  useNotificationCenter: () => ({
    openConfirm: openConfirmMock,
  }),
}));

vi.mock("./CodeTextPreview", () => ({
  default: ({
    content,
    readOnly = true,
    onChange,
    onSave,
  }) => (
    <div>
      <div data-testid="preview-text-content">{content}</div>
      <div data-testid="preview-read-only">{readOnly ? "true" : "false"}</div>
      <button type="button" onClick={() => onChange?.(`${content} updated`)}>
        mock-change
      </button>
      <button type="button" onClick={() => onSave?.()}>
        mock-save
      </button>
    </div>
  ),
}));

function PreviewPanelHarness({ initialPaneState = undefined }) {
  const [paneState, setPaneState] = useState(
    normalizePreviewPaneState(initialPaneState),
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

function createSingleTabPaneState(path, options = {}) {
  return {
    tabs: [
      {
        path,
        isEphemeral: options?.isEphemeral ?? true,
        isDirty: options?.isDirty ?? false,
        draftContent: options?.draftContent ?? "",
      },
    ],
    activePath: path,
  };
}

describe("PreviewPanel", () => {
  beforeEach(() => {
    filesystemWatchCallback = undefined;
    invoke.mockReset();
    convertFileSrc.mockClear();
    openConfirmMock.mockReset();
    openConfirmMock.mockResolvedValue(true);
  });

  it("shows a placeholder when there are no preview tabs", () => {
    render(<PreviewPanelHarness initialPaneState={{ tabs: [], activePath: "" }} />);

    expect(screen.getByLabelText("Preview panel")).toBeInTheDocument();
    expect(screen.getByText("Select a file to preview.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("loads and renders plain text previews for the active preview tab", async () => {
    invoke.mockResolvedValue({
      kind: "text",
      content: "hello preview",
      truncated: false,
    });

    render(
      <PreviewPanelHarness
        initialPaneState={createSingleTabPaneState("C:\\notes.txt")}
      />,
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("preview_read_file", {
        path: "C:\\notes.txt",
      });
    });

    expect(await screen.findByTestId("preview-text-content")).toHaveTextContent("hello preview");
    expect(screen.getByRole("tab", { name: "notes.txt" })).toBeInTheDocument();
  });

  it("loads and renders image previews", async () => {
    invoke.mockResolvedValue({
      kind: "image",
      mimeType: "image/png",
    });

    render(
      <PreviewPanelHarness
        initialPaneState={createSingleTabPaneState("C:\\image.png")}
      />,
    );

    const image = await screen.findByRole("img", { name: /preview of image\.png/i });
    expect(image.getAttribute("src")).toContain("asset://localhost/C%3A%5Cimage.png");
    expect(image.getAttribute("src")).toMatch(/\?v=\d+$/);
    expect(convertFileSrc).toHaveBeenCalledWith("C:\\image.png");
  });

  it("marks tab as dirty while editing and clears dirty state after save", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") {
        return null;
      }
      if (command === "preview_read_file") {
        return {
          kind: "text",
          content: "hello preview",
          truncated: false,
        };
      }
      if (command === "preview_write_text_file") return null;
      throw new Error(`Unhandled invoke: ${command}`);
    });

    render(
      <PreviewPanelHarness
        initialPaneState={createSingleTabPaneState("C:\\notes.txt")}
      />,
    );

    await screen.findByTestId("preview-text-content");
    const tabButton = screen.getByRole("tab", { name: "notes.txt" });
    expect(tabButton.getAttribute("title")).toContain("ephemeral");

    fireEvent.click(screen.getByRole("button", { name: "mock-change" }));
    expect(await screen.findByText("Unsaved changes.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /notes\.txt \*/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /notes\.txt \*/i }).getAttribute("title")).not.toContain("ephemeral");

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("preview_write_text_file", {
        path: "C:\\notes.txt",
        content: "hello preview updated",
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: /notes\.txt \*/i })).not.toBeInTheDocument();
    });
  });

  it("double click on an ephemeral tab removes ephemeral flag", async () => {
    invoke.mockResolvedValue({
      kind: "text",
      content: "hello preview",
      truncated: false,
    });

    render(
      <PreviewPanelHarness
        initialPaneState={createSingleTabPaneState("C:\\notes.txt")}
      />,
    );

    const tabButton = await screen.findByRole("tab", { name: "notes.txt" });
    expect(tabButton.getAttribute("title")).toContain("ephemeral");
    fireEvent.doubleClick(tabButton);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "notes.txt" }).getAttribute("title")).not.toContain("ephemeral");
    });
  });

  it("closes tabs from the header close button", async () => {
    invoke.mockResolvedValue({
      kind: "text",
      content: "hello preview",
      truncated: false,
    });

    render(
      <PreviewPanelHarness
        initialPaneState={createSingleTabPaneState("C:\\notes.txt", {
          isEphemeral: false,
        })}
      />,
    );

    await screen.findByRole("tab", { name: "notes.txt" });
    fireEvent.click(screen.getByRole("button", { name: /close notes\.txt/i }));

    expect(await screen.findByText("Select a file to preview.")).toBeInTheDocument();
    expect(openConfirmMock).not.toHaveBeenCalled();
  });

  it("requires confirmation before closing a dirty tab", async () => {
    invoke.mockResolvedValue({
      kind: "text",
      content: "hello preview",
      truncated: false,
    });

    render(
      <PreviewPanelHarness
        initialPaneState={createSingleTabPaneState("C:\\notes.txt", {
          isEphemeral: false,
          isDirty: true,
          draftContent: "draft text",
        })}
      />,
    );

    await screen.findByRole("tab", { name: /notes\.txt \*/i });
    fireEvent.click(screen.getByRole("button", { name: /close notes\.txt/i }));

    await waitFor(() => {
      expect(openConfirmMock).toHaveBeenCalledWith({
        title: "Discard unsaved changes?",
        message: "Close this tab and discard unsaved changes?",
        tone: "warning",
        confirmLabel: "Close tab",
        cancelLabel: "Cancel",
      });
    });
    expect(await screen.findByText("Select a file to preview.")).toBeInTheDocument();
  });

  it("keeps dirty tab open when close confirmation is cancelled", async () => {
    openConfirmMock.mockResolvedValueOnce(false);
    invoke.mockResolvedValue({
      kind: "text",
      content: "hello preview",
      truncated: false,
    });

    render(
      <PreviewPanelHarness
        initialPaneState={createSingleTabPaneState("C:\\notes.txt", {
          isEphemeral: false,
          isDirty: true,
          draftContent: "draft text",
        })}
      />,
    );

    await screen.findByRole("tab", { name: /notes\.txt \*/i });
    fireEvent.click(screen.getByRole("button", { name: /close notes\.txt/i }));

    await waitFor(() => {
      expect(openConfirmMock).toHaveBeenCalled();
    });
    expect(screen.getByRole("tab", { name: /notes\.txt \*/i })).toBeInTheDocument();
  });

  it("starts a watcher for the preview file parent directory", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "filesystem_watch_start" || command === "filesystem_watch_stop") {
        return null;
      }
      if (command === "preview_read_file") {
        return {
          kind: "text",
          content: "preview content",
          truncated: false,
        };
      }
      throw new Error(`Unhandled invoke: ${command}`);
    });

    const { unmount } = render(
      <PreviewPanelHarness
        initialPaneState={createSingleTabPaneState("C:\\notes.txt", {
          isEphemeral: false,
        })}
      />,
    );

    await screen.findByTestId("preview-text-content");

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "filesystem_watch_start",
        expect.objectContaining({ path: "C:\\" }),
      );
      expect(typeof filesystemWatchCallback).toBe("function");
    });

    unmount();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "filesystem_watch_stop",
        expect.objectContaining({ watchId: expect.any(String) }),
      );
    });
  });
});
