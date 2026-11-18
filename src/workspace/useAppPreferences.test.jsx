import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import useAppPreferences from "./useAppPreferences";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

let emitPreferencesUpdated;

describe("useAppPreferences", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    listen.mockImplementation(async (eventName, handler) => {
      if (eventName === "app-preferences-updated") emitPreferencesUpdated = (payload) => act(() => handler({ payload }));
      return () => {};
    });
  });

  it("starts empty and loads the stored preferences", async () => {
    invoke.mockResolvedValue({ showHiddenFiles: false });

    const { result } = renderHook(() => useAppPreferences());

    expect(result.current.preferences).toBeNull();
    await waitFor(() => expect(result.current.preferences).toEqual({ showHiddenFiles: false }));
    expect(invoke).toHaveBeenCalledWith("app_preferences_get");
  });

  it("falls back to showing hidden files when the preferences cannot be read", async () => {
    invoke.mockRejectedValue(new Error("no app data dir"));

    const { result } = renderHook(() => useAppPreferences());

    await waitFor(() => expect(result.current.preferences).toEqual({ showHiddenFiles: true }));
  });

  it("saves the flipped value and applies it from the broadcast", async () => {
    invoke.mockImplementation(async (command) => (
      command === "app_preferences_get" ? { showHiddenFiles: true } : null
    ));
    const { result } = renderHook(() => useAppPreferences());
    await waitFor(() => expect(result.current.preferences).toEqual({ showHiddenFiles: true }));

    act(() => result.current.toggleShowHiddenFiles());

    expect(invoke).toHaveBeenCalledWith("app_preferences_set", { preferences: { showHiddenFiles: false } });
    expect(result.current.preferences).toEqual({ showHiddenFiles: true });

    emitPreferencesUpdated({ showHiddenFiles: false });
    expect(result.current.preferences).toEqual({ showHiddenFiles: false });
  });

  it("reports a failed save", async () => {
    const pushNotification = vi.fn();
    invoke.mockImplementation(async (command) => {
      if (command === "app_preferences_set") throw "Access is denied.";
      return { showHiddenFiles: true };
    });
    const { result } = renderHook(() => useAppPreferences({ pushNotification }));
    await waitFor(() => expect(result.current.preferences).not.toBeNull());

    act(() => result.current.toggleShowHiddenFiles());

    await waitFor(() => expect(pushNotification).toHaveBeenCalledWith({
      title: "Failed to save preferences",
      message: "Access is denied.",
      tone: "error",
    }));
  });
});
