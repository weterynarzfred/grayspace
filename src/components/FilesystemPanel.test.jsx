import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import FilesystemPanel from "./FilesystemPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("FilesystemPanel", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (command, payload) => {
      if (command === "list_drives") {
        return [{ name: "C:", path: "C:\\" }];
      }

      if (command === "list_directory" && payload?.path === "C:\\") {
        return [
          { name: "Users", path: "C:\\Users", is_dir: true },
          { name: "notes.txt", path: "C:\\notes.txt", is_dir: false },
        ];
      }

      if (command === "list_directory" && payload?.path === "C:\\Users") {
        return [];
      }

      if (command === "parent_path" && payload?.path === "C:\\Users") {
        return "C:\\";
      }

      throw new Error(`Unhandled invoke: ${command}`);
    });
  });

  it("loads and shows available drives", async () => {
    render(<FilesystemPanel />);

    expect(screen.getByText("Loading drives...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("C:")).toBeInTheDocument();
    });
  });

  it("navigates into a selected drive and lists entries", async () => {
    render(<FilesystemPanel />);

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.click(driveButton);

    expect(await screen.findByText("Files")).toBeInTheDocument();
    expect(await screen.findByText("Users")).toBeInTheDocument();
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByText("..")).toBeInTheDocument();
  });

  it("uses breadcrumbs to jump back to a parent path", async () => {
    render(<FilesystemPanel />);

    const driveButton = await screen.findByRole("button", { name: /C:\\/i });
    fireEvent.click(driveButton);

    const usersButton = await screen.findByRole("button", { name: /Users/i });
    fireEvent.click(usersButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Users/i })).toBeInTheDocument();
    });

    const pathNav = screen.getByRole("navigation", { name: "Current path" });
    const rootCrumb = Array.from(pathNav.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "C:\\",
    );

    expect(rootCrumb).toBeDefined();
    fireEvent.click(rootCrumb);

    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
  });
});
