import { render, screen } from "@testing-library/react";
import App from "./App";
import { NotificationCenterProvider } from "./notifications/notificationCenter";

// Nothing answers, so the app stays on its first render: no window, tab or preferences yet.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => new Promise(() => {})),
  convertFileSrc: vi.fn((path) => path),
  Channel: class Channel {},
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ label: "main" })),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({ label: "main" })),
}));

describe("App", () => {
  it("shows the loading shell before the workspace and preferences have loaded", () => {
    render(<NotificationCenterProvider><App /></NotificationCenterProvider>);

    expect(screen.getByText("Loading workspace...")).toBeInTheDocument();
  });
});
