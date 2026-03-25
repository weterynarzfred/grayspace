import { fireEvent, render, screen, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("react-resizable-panels", () => ({
  Group: ({ children, id, onLayoutChanged }) => <div>
    {children}
    <button
      type="button"
      aria-label={`Mock resize ${id ?? "group"}`}
      onClick={() => {
        if (!id) return;
        const collectPanelIds = (nodes, output = []) => {
          const nodeList = Array.isArray(nodes) ? nodes : [nodes];
          nodeList.forEach(node => {
            if (!node || typeof node !== "object") return;
            const panelId = node?.props?.id;
            if (typeof panelId === "string" && panelId.includes("-segment-")) {
              output.push(panelId);
            }
            if (node?.props?.children) collectPanelIds(node.props.children, output);
          });
          return output;
        };

        const panelIds = collectPanelIds(children);
        if (!panelIds.length) return;

        const panelSizes = panelIds.length === 2
          ? [68, 32]
          : panelIds.length === 3
            ? [30, 20, 50]
            : panelIds.map(() => 100 / panelIds.length);
        const layoutByPanel = panelIds.reduce((result, panelId, index) => {
          result[panelId] = panelSizes[index] ?? (100 / panelIds.length);
          return result;
        }, {});

        onLayoutChanged?.(layoutByPanel);
      }}
    >
      MockResize
    </button>
  </div>,
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
    const onPaneActivate = vi.fn();
    const paneId = "pane-a";

    render(
      <WorkspacePanelLayout
        tab={{
          tabId: "tab-1",
          layout: {
            kind: "split",
            axis: "row",
            ratio: 50,
            first: {
              kind: "leaf",
              paneId,
            },
            second: {
              kind: "leaf",
              paneId: "pane-b",
            },
          },
          activePaneId: paneId,
          selectedFiles: {
            selectedPath: "",
            selectedPaths: [],
          },
          paneStates: {
            [paneId]: {
              paneId,
              panelType: "Filesystem",
              terminalSessionId: "term-1",
              filesystemState: {
                currentDrive: "",
                currentPath: "",
                selectedPath: "",
                scrollTop: 0,
              },
            },
            "pane-b": {
              paneId: "pane-b",
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
        onPaneActivate={onPaneActivate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "FilesystemMock" }));

    expect(onCurrentPathChange).toHaveBeenCalledWith("tab-1", paneId, "C:\\Mock");
    expect(onFilesystemStateChange).toHaveBeenCalledWith("tab-1", paneId, {
      currentDrive: "C:\\",
      currentPath: "C:\\Mock",
      selectedPath: "C:\\Mock\\test.txt",
      scrollTop: 25,
    });
    expect(onTabSelectedFilesChange).toHaveBeenCalledWith("tab-1", {
      selectedPath: "C:\\Mock\\test.txt",
      selectedPaths: ["C:\\Mock\\test.txt"],
    });
    expect(onPanelTypeChange).toHaveBeenCalledWith("tab-1", paneId, "Terminal");
  });

  it("renders pane controls and forwards split/close actions", () => {
    const onPaneSplit = vi.fn();
    const onPaneClose = vi.fn();

    render(
      <WorkspacePanelLayout
        tab={{
          tabId: "tab-pane-controls",
          layout: {
            kind: "split",
            axis: "row",
            ratio: 50,
            first: {
              kind: "leaf",
              paneId: "pane-left",
            },
            second: {
              kind: "leaf",
              paneId: "pane-right",
            },
          },
          activePaneId: "pane-left",
          selectedFiles: {
            selectedPath: "",
            selectedPaths: [],
          },
          paneStates: {
            "pane-left": {
              paneId: "pane-left",
              panelType: "Canvas",
              terminalSessionId: "term-1",
              filesystemState: {
                currentDrive: "",
                currentPath: "",
                selectedPath: "",
                selectedPaths: [],
                scrollTop: 0,
              },
            },
            "pane-right": {
              paneId: "pane-right",
              panelType: "Canvas",
              terminalSessionId: "term-2",
              filesystemState: {
                currentDrive: "",
                currentPath: "",
                selectedPath: "",
                selectedPaths: [],
                scrollTop: 0,
              },
            },
          },
        }}
        onPaneSplit={onPaneSplit}
        onPaneClose={onPaneClose}
      />,
    );

    const leftPane = document.querySelector('[data-pane-id="pane-left"]');
    expect(leftPane).toBeTruthy();

    const rightSplitHandle = within(leftPane).getByRole("button", { name: "Split pane right" });
    fireEvent.pointerDown(rightSplitHandle, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(rightSplitHandle, { pointerId: 1, clientX: 42, clientY: 12 });
    expect(within(leftPane).getByTestId("split-preview-pane-left")).toHaveAttribute(
      "data-direction",
      "right",
    );
    fireEvent.pointerUp(rightSplitHandle, { pointerId: 1, clientX: 45, clientY: 12 });
    expect(within(leftPane).queryByTestId("split-preview-pane-left")).not.toBeInTheDocument();
    expect(onPaneSplit).toHaveBeenCalledWith("tab-pane-controls", "pane-left", "right");

    const downSplitHandle = within(leftPane).getByRole("button", { name: "Split pane down" });
    fireEvent.pointerDown(downSplitHandle, { pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(downSplitHandle, { pointerId: 2, clientX: 12, clientY: 42 });
    expect(within(leftPane).getByTestId("split-preview-pane-left")).toHaveAttribute(
      "data-direction",
      "bottom",
    );
    fireEvent.pointerUp(downSplitHandle, { pointerId: 2, clientX: 12, clientY: 45 });
    expect(within(leftPane).queryByTestId("split-preview-pane-left")).not.toBeInTheDocument();
    expect(onPaneSplit).toHaveBeenCalledWith("tab-pane-controls", "pane-left", "bottom");

    fireEvent.pointerDown(rightSplitHandle, { pointerId: 3, clientX: 20, clientY: 20 });
    fireEvent.pointerUp(rightSplitHandle, { pointerId: 3, clientX: 22, clientY: 22 });
    expect(onPaneSplit).toHaveBeenCalledTimes(2);

    fireEvent.click(within(leftPane).getByRole("button", { name: "Close Pane" }));
    expect(onPaneClose).toHaveBeenCalledWith("tab-pane-controls", "pane-left");
  });

  it("reports split ratio changes for the active tab layout path", () => {
    const onSplitRatioChange = vi.fn();

    render(
      <WorkspacePanelLayout
        tab={{
          tabId: "tab-ratio",
          layout: {
            kind: "split",
            axis: "row",
            ratio: 50,
            first: {
              kind: "leaf",
              paneId: "pane-left",
            },
            second: {
              kind: "leaf",
              paneId: "pane-right",
            },
          },
          activePaneId: "pane-left",
          selectedFiles: {
            selectedPath: "",
            selectedPaths: [],
          },
          paneStates: {
            "pane-left": {
              paneId: "pane-left",
              panelType: "Filesystem",
              terminalSessionId: "term-left",
              filesystemState: {
                currentDrive: "",
                currentPath: "",
                selectedPath: "",
                selectedPaths: [],
                scrollTop: 0,
              },
            },
            "pane-right": {
              paneId: "pane-right",
              panelType: "Preview",
              terminalSessionId: "term-right",
              filesystemState: {
                currentDrive: "",
                currentPath: "",
                selectedPath: "",
                selectedPaths: [],
                scrollTop: 0,
              },
            },
          },
        }}
        onSplitRatioChange={onSplitRatioChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Mock resize workspace-split-tab-ratio-root" }),
    );

    expect(onSplitRatioChange).toHaveBeenCalledWith("tab-ratio", "root", 68);
  });

  it("flattens same-axis split chains and reports nested ratios", () => {
    const onSplitRatioChange = vi.fn();

    render(
      <WorkspacePanelLayout
        tab={{
          tabId: "tab-chain",
          layout: {
            kind: "split",
            axis: "row",
            ratio: 70,
            first: {
              kind: "split",
              axis: "row",
              ratio: 50,
              first: {
                kind: "leaf",
                paneId: "pane-a",
              },
              second: {
                kind: "leaf",
                paneId: "pane-b",
              },
            },
            second: {
              kind: "leaf",
              paneId: "pane-c",
            },
          },
          activePaneId: "pane-a",
          selectedFiles: {
            selectedPath: "",
            selectedPaths: [],
          },
          paneStates: {
            "pane-a": {
              paneId: "pane-a",
              panelType: "Filesystem",
              terminalSessionId: "term-a",
              filesystemState: {
                currentDrive: "",
                currentPath: "",
                selectedPath: "",
                selectedPaths: [],
                scrollTop: 0,
              },
            },
            "pane-b": {
              paneId: "pane-b",
              panelType: "Preview",
              terminalSessionId: "term-b",
              filesystemState: {
                currentDrive: "",
                currentPath: "",
                selectedPath: "",
                selectedPaths: [],
                scrollTop: 0,
              },
            },
            "pane-c": {
              paneId: "pane-c",
              panelType: "Canvas",
              terminalSessionId: "term-c",
              filesystemState: {
                currentDrive: "",
                currentPath: "",
                selectedPath: "",
                selectedPaths: [],
                scrollTop: 0,
              },
            },
          },
        }}
        onSplitRatioChange={onSplitRatioChange}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Mock resize workspace-split-tab-chain-root" }),
    );

    expect(onSplitRatioChange.mock.calls).toEqual(expect.arrayContaining([
      ["tab-chain", "root", 50],
      ["tab-chain", "root-first", 60],
    ]));
    expect(onSplitRatioChange).toHaveBeenCalledTimes(2);
  });
});
