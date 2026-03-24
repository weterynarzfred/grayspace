import { fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }) => <div>{children}</div>,
  Panel: ({ children }) => <div>{children}</div>,
  Separator: (props) => <div {...props} />,
}));

vi.mock("./FilesystemPanel/FilesystemPanel", () => ({
  default: ({
    onCurrentPathChange,
    onFilesystemStateChange,
    onTabSelectedFilesChange,
    onPanelTypeChange,
  }) => (
    <button
      type="button"
      onClick={() => {
        onCurrentPathChange?.("C:\\Mock");
        onFilesystemStateChange?.({
          currentDrive: "C:\\",
          currentPath: "C:\\Mock",
          selectedPath: "C:\\Mock\\test.txt",
          scrollTop: 25,
        });
        onTabSelectedFilesChange?.({
          selectedPath: "C:\\Mock\\test.txt",
          selectedPaths: ["C:\\Mock\\test.txt"],
        });
        onPanelTypeChange?.("Terminal");
      }}
    >
      FilesystemMock
    </button>
  ),
}));

import WorkspacePanelLayout from "./WorkspacePanelLayout";

describe("WorkspacePanelLayout", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({
      kind: "text",
      content: "mock preview",
      truncated: false,
    });
  });

  it("forwards callbacks with explicit tabId and pane identifiers", () => {
    const onCurrentPathChange = vi.fn();
    const onFilesystemStateChange = vi.fn();
    const onTabSelectedFilesChange = vi.fn();
    const onPanelTypeChange = vi.fn();

    render(
      <WorkspacePanelLayout
        tab={{
          tabId: "tab-1",
          layout: { split: 50 },
          selectedFiles: {
            selectedPath: "",
            selectedPaths: [],
          },
          paneStates: {
            left: {
              paneId: "tab-1-left",
              panelType: "Filesystem",
              terminalSessionId: "term-1",
              filesystemState: {
                currentDrive: "",
                currentPath: "",
                selectedPath: "",
                scrollTop: 0,
              },
            },
            right: {
              paneId: "tab-1-right",
              panelType: "Preview",
              terminalSessionId: "term-2",
              filesystemState: {
                currentDrive: "",
                currentPath: "",
                selectedPath: "",
                scrollTop: 0,
              },
            },
          },
        }}
        onCurrentPathChange={onCurrentPathChange}
        onFilesystemStateChange={onFilesystemStateChange}
        onTabSelectedFilesChange={onTabSelectedFilesChange}
        onPanelTypeChange={onPanelTypeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "FilesystemMock" }));

    expect(onCurrentPathChange).toHaveBeenCalledWith("tab-1", "left", "C:\\Mock");
    expect(onFilesystemStateChange).toHaveBeenCalledWith("tab-1", "left", {
      currentDrive: "C:\\",
      currentPath: "C:\\Mock",
      selectedPath: "C:\\Mock\\test.txt",
      scrollTop: 25,
    });
    expect(onTabSelectedFilesChange).toHaveBeenCalledWith("tab-1", {
      selectedPath: "C:\\Mock\\test.txt",
      selectedPaths: ["C:\\Mock\\test.txt"],
    });
    expect(onPanelTypeChange).toHaveBeenCalledWith("tab-1", "left", "Terminal");
  });
});
