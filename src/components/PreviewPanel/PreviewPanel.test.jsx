import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import PreviewPanel from "./PreviewPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("PreviewPanel", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("shows a placeholder when there is no selected file", () => {
    render(
      <PreviewPanel
        tabSelectedFiles={{
          selectedPath: "",
          selectedPaths: [],
        }}
      />,
    );

    expect(screen.getByText("Preview panel")).toBeInTheDocument();
    expect(screen.getByText("Select a file to preview.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("loads and renders plain text previews", async () => {
    invoke.mockResolvedValue({
      kind: "text",
      content: "hello preview",
      truncated: false,
    });

    render(
      <PreviewPanel
        tabSelectedFiles={{
          selectedPath: "C:\\notes.txt",
          selectedPaths: ["C:\\notes.txt"],
        }}
      />,
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("preview_read_file", {
        path: "C:\\notes.txt",
      });
    });

    expect(await screen.findByTestId("preview-text-content")).toHaveTextContent("hello preview");
  });

  it("loads and renders image previews", async () => {
    invoke.mockResolvedValue({
      kind: "image",
      mimeType: "image/png",
      dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    });

    render(
      <PreviewPanel
        tabSelectedFiles={{
          selectedPath: "C:\\image.png",
          selectedPaths: ["C:\\image.png"],
        }}
      />,
    );

    const image = await screen.findByRole("img", { name: /preview of preview panel: image\.png/i });
    expect(image).toHaveAttribute(
      "src",
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    );
  });

  it("accepts snake_case image fields from backend payloads", async () => {
    invoke.mockResolvedValue({
      kind: "image",
      mime_type: "image/png",
      data_base64: "AAAA",
    });

    render(
      <PreviewPanel
        tabSelectedFiles={{
          selectedPath: "C:\\image.png",
          selectedPaths: ["C:\\image.png"],
        }}
      />,
    );

    const image = await screen.findByRole("img", { name: /preview of preview panel: image\.png/i });
    expect(image).toHaveAttribute("src", "data:image/png;base64,AAAA");
  });

  it("shows unsupported-type messages returned by the backend", async () => {
    invoke.mockResolvedValue({
      kind: "unsupported",
      reason: "PDF document previews are not supported yet.",
    });

    render(
      <PreviewPanel
        tabSelectedFiles={{
          selectedPath: "C:\\spec.pdf",
          selectedPaths: ["C:\\spec.pdf"],
        }}
      />,
    );

    expect(await screen.findByText("PDF document previews are not supported yet.")).toBeInTheDocument();
  });

  it("surfaces preview loading errors", async () => {
    invoke.mockRejectedValue(new Error("Permission denied."));

    render(
      <PreviewPanel
        tabSelectedFiles={{
          selectedPath: "C:\\locked.txt",
          selectedPaths: ["C:\\locked.txt"],
        }}
      />,
    );

    expect(await screen.findByText("Permission denied.")).toBeInTheDocument();
  });
});
