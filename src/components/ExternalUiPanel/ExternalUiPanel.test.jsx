import { render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import ExternalUiPanel from "./ExternalUiPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("ExternalUiPanel", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("loads externalUI URL from repaired .grayspace/folder.json", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "workspace_read_folder_config") {
        return "{ externalUI: 'http://localhost:3000', }";
      }
      throw new Error(`Unhandled invoke command: ${command}`);
    });

    render(<ExternalUiPanel cwdHint="C:\\Workspace" />);

    const frame = await screen.findByTitle("External UI");
    expect(frame.getAttribute("src")).toContain("http://localhost:3000");
  });

  it("prefers workspace root over cwd when loading config", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "workspace_read_folder_config") {
        return "{\"externalUI\":\"http://localhost:5173\"}";
      }
      throw new Error(`Unhandled invoke command: ${command}`);
    });

    render(
      <ExternalUiPanel
        cwdHint="C:\\WorkspaceRoot\\Nested"
        tabWorkspaceRoot="C:\\WorkspaceRoot"
      />,
    );

    await screen.findByTitle("External UI");
    const configLoadCall = invoke.mock.calls.find(([command]) => command === "workspace_read_folder_config");
    expect(configLoadCall).toBeTruthy();
    const resolvedWorkspaceRoot = String(configLoadCall?.[1]?.workspaceRoot ?? "")
      .replace(/\\\\/g, "\\");
    expect(resolvedWorkspaceRoot).toBe("C:\\WorkspaceRoot");
  });

  it("shows a helpful message when externalUI is missing", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "workspace_read_folder_config") return "{\"scripts\":{}}";
      throw new Error(`Unhandled invoke command: ${command}`);
    });

    render(<ExternalUiPanel cwdHint="C:\\Workspace" />);

    expect(await screen.findByText(/No externalUI URL found/i)).toBeInTheDocument();
    expect(screen.queryByTitle("External UI")).not.toBeInTheDocument();
  });

  it("rejects unsafe URL schemes", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "workspace_read_folder_config") return "{\"externalUI\":\"javascript:alert('x')\"}";
      throw new Error(`Unhandled invoke command: ${command}`);
    });

    render(<ExternalUiPanel cwdHint="C:\\Workspace" />);

    expect(await screen.findByText(/must use http or https/i)).toBeInTheDocument();
    expect(screen.queryByTitle("External UI")).not.toBeInTheDocument();
  });
});
