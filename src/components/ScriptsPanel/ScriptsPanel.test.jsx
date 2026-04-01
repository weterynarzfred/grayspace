import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import ScriptsPanel from "./ScriptsPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("ScriptsPanel", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("loads scripts from repaired .grayspace/folder.json", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "workspace_read_folder_config")
        return "{ scripts: { build: 'npm run build', test: 'npm test', }, }";
      if (command === "terminal_run_command") return null;
      throw new Error(`Unhandled invoke command: ${command}`);
    });

    render(
      <ScriptsPanel
        cwdHint="C:\\Workspace"
        terminalSessionId="term-left"
      />,
    );

    expect(await screen.findByRole("button", { name: "build" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "test" })).toBeInTheDocument();
    expect(screen.queryByText(/No scripts found/i)).not.toBeInTheDocument();
  });

  it("switches to terminal and runs selected command", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "workspace_read_folder_config")
        return "{\"scripts\":{\"build\":\"npm run build\"}}";
      if (command === "terminal_run_command") return null;
      throw new Error(`Unhandled invoke command: ${command}`);
    });
    const onPanelTypeChange = vi.fn();

    render(
      <ScriptsPanel
        cwdHint="C:\\Workspace"
        terminalSessionId="term-left"
        onPanelTypeChange={onPanelTypeChange}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "build" }));

    expect(onPanelTypeChange).toHaveBeenCalledWith("Terminal");
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("terminal_run_command", {
        sessionId: "term-left",
        command: "npm run build",
      });
    });
  });

  it("prefers tab workspace root when loading scripts", async () => {
    invoke.mockImplementation(async (command) => {
      if (command === "workspace_read_folder_config")
        return "{\"scripts\":{\"build\":\"npm run build\"}}";
      if (command === "terminal_run_command") return null;
      throw new Error(`Unhandled invoke command: ${command}`);
    });

    render(
      <ScriptsPanel
        cwdHint="C:\\WorkspaceRoot\\Nested"
        tabWorkspaceRoot="C:\\WorkspaceRoot"
        terminalSessionId="term-left"
      />,
    );

    expect(await screen.findByRole("button", { name: "build" })).toBeInTheDocument();
    const configLoadCall = invoke.mock.calls.find(([command]) => command === "workspace_read_folder_config");
    expect(configLoadCall).toBeTruthy();
    const resolvedWorkspaceRoot = String(configLoadCall?.[1]?.workspaceRoot ?? "")
      .replace(/\\\\/g, "\\");
    expect(resolvedWorkspaceRoot).toBe("C:\\WorkspaceRoot");
    expect(resolvedWorkspaceRoot).not.toBe("C:\\WorkspaceRoot\\Nested");
  });
});
