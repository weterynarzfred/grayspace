import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import PanelsDndLayer from "../PanelsDndLayer";
import PreviewPanel from "./PreviewPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path) => `asset://localhost/${encodeURIComponent(path || "")}`),
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

describe("PreviewPanel", () => {
  function renderPreviewPanel(props = {}) {
    return render(
      <PanelsDndLayer>
        <PreviewPanel {...props} />
      </PanelsDndLayer>,
    );
  }

  beforeEach(() => {
    invoke.mockReset();
    convertFileSrc.mockClear();
  });

  it("shows a placeholder when there is no selected file", () => {
    renderPreviewPanel({
      tabSelectedFiles: {
        selectedPaths: [],
      },
    });

    expect(screen.getByLabelText("Preview panel")).toBeInTheDocument();
    expect(screen.getByText("Select a file to preview.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("loads and renders plain text previews", async () => {
    invoke.mockResolvedValue({
      kind: "text",
      content: "hello preview",
      truncated: false,
    });

    renderPreviewPanel({
      tabSelectedFiles: {
        selectedPaths: ["C:\\notes.txt"],
      },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("preview_read_file", {
        path: "C:\\notes.txt",
      });
    });

    expect(await screen.findByTestId("preview-text-content")).toHaveTextContent("hello preview");
    expect(screen.getByText("notes.txt").tagName).toBe("EM");
  });

  it("loads and renders image previews", async () => {
    invoke.mockResolvedValue({
      kind: "image",
      mimeType: "image/png",
    });

    renderPreviewPanel({
      tabSelectedFiles: {
        selectedPaths: ["C:\\image.png"],
      },
    });

    const image = await screen.findByRole("img", { name: /preview of image\.png/i });
    expect(image).toHaveAttribute(
      "src",
      "asset://localhost/C%3A%5Cimage.png",
    );
    expect(convertFileSrc).toHaveBeenCalledWith("C:\\image.png");
  });

  it("loads and renders video previews", async () => {
    invoke.mockResolvedValue({
      kind: "video",
      mimeType: "video/mp4",
    });

    renderPreviewPanel({
      tabSelectedFiles: {
        selectedPaths: ["C:\\movie.mp4"],
      },
    });

    const video = await screen.findByTestId("preview-video");
    expect(video).toHaveAttribute("src", "asset://localhost/C%3A%5Cmovie.mp4");
    expect(convertFileSrc).toHaveBeenCalledWith("C:\\movie.mp4");
  });

  it("loads and renders audio previews", async () => {
    invoke.mockResolvedValue({
      kind: "audio",
      mimeType: "audio/mpeg",
    });

    renderPreviewPanel({
      tabSelectedFiles: {
        selectedPaths: ["C:\\song.mp3"],
      },
    });

    const audio = await screen.findByTestId("preview-audio");
    expect(audio).toHaveAttribute("src", "asset://localhost/C%3A%5Csong.mp3");
    expect(convertFileSrc).toHaveBeenCalledWith("C:\\song.mp3");
  });

  it("shows unsupported-type messages returned by the backend", async () => {
    invoke.mockResolvedValue({
      kind: "unsupported",
      reason: "PDF document previews are not supported yet.",
    });

    renderPreviewPanel({
      tabSelectedFiles: {
        selectedPaths: ["C:\\spec.pdf"],
      },
    });

    expect(await screen.findByText("PDF document previews are not supported yet.")).toBeInTheDocument();
  });

  it("shows a friendly unsupported message for folders", async () => {
    invoke.mockRejectedValue(new Error("Preview is only available for files."));

    renderPreviewPanel({
      tabSelectedFiles: {
        selectedPaths: ["C:\\workspace"],
      },
    });

    expect(await screen.findByText("Folder previews are not supported yet.")).toBeInTheDocument();
    expect(screen.queryByText("Preview is only available for files.")).not.toBeInTheDocument();
  });

  it("surfaces preview loading errors", async () => {
    invoke.mockRejectedValue(new Error("Permission denied."));

    renderPreviewPanel({
      tabSelectedFiles: {
        selectedPaths: ["C:\\locked.txt"],
      },
    });

    expect(await screen.findByText("Permission denied.")).toBeInTheDocument();
  });

  it("saves text edits only when save is triggered", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "preview_read_file") {
        return {
          kind: "text",
          content: "hello preview",
          truncated: false,
        };
      }

      if (command === "preview_write_text_file") {
        return null;
      }

      throw new Error(`Unhandled invoke: ${command}`);
    });

    renderPreviewPanel({
      tabSelectedFiles: {
        selectedPaths: ["C:\\notes.txt"],
      },
    });

    await screen.findByTestId("preview-text-content");
    fireEvent.click(screen.getByRole("button", { name: "mock-change" }));
    expect(await screen.findByText("Unsaved changes.")).toBeInTheDocument();
    expect(
      invoke.mock.calls.some(([command]) => command === "preview_write_text_file"),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("preview_write_text_file", {
        path: "C:\\notes.txt",
        content: "hello preview updated",
      });
    });
  });

  it("keeps truncated text previews read-only", async () => {
    invoke.mockResolvedValue({
      kind: "text",
      content: "truncated preview",
      truncated: true,
    });

    renderPreviewPanel({
      tabSelectedFiles: {
        selectedPaths: ["C:\\large.txt"],
      },
    });

    expect(await screen.findByTestId("preview-read-only")).toHaveTextContent("true");
    expect(
      await screen.findByText("Preview is truncated. Editing is disabled for large files."),
    ).toBeInTheDocument();
  });

  it("auto-locks when selection changes while text edits are unsaved", async () => {
    invoke.mockImplementation(async (command, payload) => {
      if (command === "preview_read_file") {
        if (payload?.path === "C:\\notes.txt") {
          return {
            kind: "text",
            content: "notes body",
            truncated: false,
          };
        }
        if (payload?.path === "C:\\other.txt") {
          return {
            kind: "text",
            content: "other body",
            truncated: false,
          };
        }
      }

      if (command === "preview_write_text_file") {
        return null;
      }

      throw new Error(`Unhandled invoke: ${command}`);
    });

    const { rerender } = render(
      <PanelsDndLayer>
        <PreviewPanel
          tabSelectedFiles={{
            selectedPaths: ["C:\\notes.txt"],
          }}
        />
      </PanelsDndLayer>,
    );

    await screen.findByTestId("preview-text-content");
    fireEvent.click(screen.getByRole("button", { name: "mock-change" }));
    expect(await screen.findByText("Unsaved changes.")).toBeInTheDocument();

    rerender(
      <PanelsDndLayer>
        <PreviewPanel
          tabSelectedFiles={{
            selectedPaths: ["C:\\other.txt"],
          }}
        />
      </PanelsDndLayer>,
    );

    expect(screen.getByRole("button", { name: /^unlock$/i })).toBeInTheDocument();
    expect(screen.getByTestId("preview-text-content")).toHaveTextContent("notes body updated");

    const readCalls = invoke.mock.calls.filter(([command]) => command === "preview_read_file");
    expect(readCalls).toEqual([
      ["preview_read_file", { path: "C:\\notes.txt" }],
    ]);
  });

  it("keeps non-text previews pinned when manually locked", async () => {
    invoke.mockImplementation(async (command, payload) => {
      if (command === "preview_read_file") {
        if (payload?.path === "C:\\one.png") {
          return {
            kind: "image",
            mimeType: "image/png",
          };
        }
        if (payload?.path === "C:\\two.png") {
          return {
            kind: "image",
            mimeType: "image/png",
          };
        }
      }

      throw new Error(`Unhandled invoke: ${command}`);
    });

    const { rerender } = render(
      <PanelsDndLayer>
        <PreviewPanel
          tabSelectedFiles={{
            selectedPaths: ["C:\\one.png"],
          }}
        />
      </PanelsDndLayer>,
    );

    await screen.findByRole("img", { name: /preview of one\.png/i });
    fireEvent.click(screen.getByRole("button", { name: /^lock$/i }));

    rerender(
      <PanelsDndLayer>
        <PreviewPanel
          tabSelectedFiles={{
            selectedPaths: ["C:\\two.png"],
          }}
        />
      </PanelsDndLayer>,
    );

    const image = await screen.findByRole("img", { name: /preview of one\.png/i });
    expect(image).toHaveAttribute("src", "asset://localhost/C%3A%5Cone.png");
    expect(screen.getByRole("button", { name: /^unlock$/i })).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("preview_read_file", { path: "C:\\two.png" });
  });
});
