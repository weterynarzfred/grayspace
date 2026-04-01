import { describe, expect, it, vi } from "vitest";
import {
  extractExternalPathsFromDataTransfer,
  extractExternalPathsFromDataTransferItems,
} from "./useExternalPathDrop";

function makeDataTransfer({ files = [], items = [], types = [], getDataMap = {} } = {}) {
  return {
    files,
    items,
    types,
    getData: vi.fn((type) => getDataMap[type] ?? ""),
  };
}

describe("extractExternalPathsFromDataTransfer", () => {
  it("extracts file paths from uri-list payloads", () => {
    const dataTransfer = makeDataTransfer({
      types: ["text/uri-list"],
      getDataMap: {
        "text/uri-list": "file:///H:/gstest/a.txt\nfile:///H:/gstest/with%20space.md",
      },
    });

    expect(extractExternalPathsFromDataTransfer(dataTransfer)).toEqual([
      "H:\\gstest\\a.txt",
      "H:\\gstest\\with space.md",
    ]);
  });

  it("extracts path fields from dropped file-like objects", () => {
    const dataTransfer = makeDataTransfer({
      files: [{ path: "C:\\notes.txt" }, { path: "D:\\todo.md" }],
      types: ["Files"],
    });

    expect(extractExternalPathsFromDataTransfer(dataTransfer)).toEqual([
      "C:\\notes.txt",
      "D:\\todo.md",
    ]);
  });

  it("extracts plain absolute paths from text payloads", () => {
    const dataTransfer = makeDataTransfer({
      types: ["text/plain"],
      getDataMap: {
        "text/plain": "C:\\notes.txt\n\\\\server\\share\\video.mp4",
      },
    });

    expect(extractExternalPathsFromDataTransfer(dataTransfer)).toEqual([
      "C:\\notes.txt",
      "\\\\server\\share\\video.mp4",
    ]);
  });

  it("extracts paths from DownloadURL payloads", () => {
    const dataTransfer = makeDataTransfer({
      types: ["DownloadURL"],
      getDataMap: {
        DownloadURL: "application/octet-stream:notes.txt:file:///C:/notes.txt",
      },
    });

    expect(extractExternalPathsFromDataTransfer(dataTransfer)).toEqual([
      "C:\\notes.txt",
    ]);
  });

  it("extracts paths from VS Code URI payloads", () => {
    const dataTransfer = makeDataTransfer({
      types: ["text/plain"],
      getDataMap: {
        "text/plain": "vscode-file://vscode-app/c%3A/Users/test/file.txt",
      },
    });

    expect(extractExternalPathsFromDataTransfer(dataTransfer)).toEqual([
      "C:\\Users\\test\\file.txt",
    ]);
  });

  it("extracts paths from VS Code custom JSON payloads", () => {
    const dataTransfer = makeDataTransfer({
      types: ["application/vnd.code.tree.explorer"],
      getDataMap: {
        "application/vnd.code.tree.explorer": JSON.stringify({
          resourceUri: "vscode-file://vscode-app/c%3A/Users/test/notes.md",
        }),
      },
    });

    expect(extractExternalPathsFromDataTransfer(dataTransfer)).toEqual([
      "C:\\Users\\test\\notes.md",
    ]);
  });

  it("normalizes extended Windows device paths", () => {
    const dataTransfer = makeDataTransfer({
      types: ["text/plain"],
      getDataMap: {
        "text/plain": "\\\\?\\H:\\gstest\\file.txt\n\\\\?\\UNC\\server\\share\\video.mp4",
      },
    });

    expect(extractExternalPathsFromDataTransfer(dataTransfer)).toEqual([
      "H:\\gstest\\file.txt",
      "\\\\server\\share\\video.mp4",
    ]);
  });

  it("deduplicates equivalent Windows paths with repeated separators", () => {
    const dataTransfer = makeDataTransfer({
      types: ["text/plain"],
      getDataMap: {
        "text/plain": "H:\\gstest\\file.txt\nH:\\\\gstest\\\\file.txt",
      },
    });

    expect(extractExternalPathsFromDataTransfer(dataTransfer)).toEqual([
      "H:\\gstest\\file.txt",
    ]);
  });

  it("extracts paths from VS Code string items using getAsString", async () => {
    const dataTransfer = {
      items: [
        {
          kind: "string",
          type: "application/vnd.code.tree.explorer",
          getAsString: (callback) => callback(JSON.stringify({
            resource: {
              scheme: "file",
              path: "/c:/Users/test/from-item.txt",
            },
          })),
        },
      ],
    };

    await expect(extractExternalPathsFromDataTransferItems(dataTransfer)).resolves.toEqual([
      "C:\\Users\\test\\from-item.txt",
    ]);
  });
});
