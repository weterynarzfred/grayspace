import { act, fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { NotificationCenterProvider, useNotificationCenter } from "./notifications/notificationCenter";

// Unless a test answers, nothing does, so the app stays on its first render: no window, tab or
// preferences yet.
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
  getCurrentWindow: vi.fn(() => ({
    label: "main",
    onCloseRequested: vi.fn(async () => () => {}),
    // The window's bounds, read once the workspace is there, never come.
    outerPosition: vi.fn(() => new Promise(() => {})),
    innerSize: vi.fn(() => new Promise(() => {})),
    isMaximized: vi.fn(() => new Promise(() => {})),
    isMinimized: vi.fn(() => new Promise(() => {})),
  })),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({ label: "main" })),
}));
// The tabs and panes, which this file doesn't test.
vi.mock("./components/WorkspaceTabStrip", () => ({ default: () => null }));
vi.mock("./components/WorkspacePanelLayout", () => ({ default: () => null }));

// One window with one tab.
const WORKSPACE_BOOTSTRAP = {
  windowId: "window-1",
  snapshot: {
    revision: 1,
    windows: [{ windowId: "window-1", tabOrder: ["tab-1"], activeTabId: "tab-1" }],
    tabs: [{
      tabId: "tab-1",
      title: "Users",
      activePaneId: "pane-1",
      paneStates: { "pane-1": { panelType: "Filesystem", filesystemState: { currentPath: "C:\\Users" } } },
      layout: null,
    }],
  },
};

let notificationCenter;

function NotificationCenterProbe() {
  notificationCenter = useNotificationCenter();
  return null;
}

describe("App", () => {
  it("shows the loading shell before the workspace and preferences have loaded", () => {
    render(<NotificationCenterProvider><App /></NotificationCenterProvider>);

    expect(screen.getByText("Loading workspace...")).toBeInTheDocument();
  });

  it("shows each notification in new elements, so a question that takes no focus doesn't inherit it from the one before", async () => {
    invoke.mockImplementation((command) => {
      if (command === "workspace_bootstrap") return Promise.resolve(WORKSPACE_BOOTSTRAP);
      if (command === "app_preferences_get") return Promise.resolve({ showHiddenFiles: true });
      return new Promise(() => {});
    });
    render(<NotificationCenterProvider><App /><NotificationCenterProbe /></NotificationCenterProvider>);
    // Two late conflict questions in a row, e.g. of two tabs' waiting copies.
    const answers = [];
    act(() => {
      for (const title of ['Copying "a.txt": Item already exists', 'Moving "b.txt": Item already exists']) {
        notificationCenter.openChoice({
          title,
          choices: [{ id: "replace", label: "Replace" }, { id: "skip", label: "Skip" }],
          takeFocus: false,
          dismissOnOutside: false,
        }).then((answer) => answers.push(answer));
      }
    });

    const skipButton = await screen.findByRole("button", { name: "Skip" });
    // A click focuses the button in WebView2, not in jsdom.
    skipButton.focus();
    fireEvent.click(skipButton);
    await screen.findByRole("alertdialog", { name: 'Moving "b.txt": Item already exists' });
    // An Enter meant for the pane.
    await act(async () => {
      fireEvent.keyDown(document.activeElement, { key: "Enter" });
    });

    expect(document.activeElement).toBe(document.body);
    expect(answers).toEqual(["skip"]);
  });
});
