import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { getErrorMessage } from "./appRuntime";

const APP_PREFERENCES_UPDATED_EVENT = "app-preferences-updated";
const DEFAULT_APP_PREFERENCES = { showHiddenFiles: true };

// App-wide preferences, stored by the backend. `preferences` stays null until the first read, so
// the app can wait for it instead of listing folders with the wrong settings. Changes are saved
// by the backend and come back to every window, this one included, as a broadcast.
export default function useAppPreferences({ pushNotification = undefined } = {}) {
  const [preferences, setPreferences] = useState(null);

  useEffect(() => {
    invoke("app_preferences_get")
      .then(setPreferences)
      .catch(() => setPreferences(DEFAULT_APP_PREFERENCES));
    const unlistenPromise = listen(APP_PREFERENCES_UPDATED_EVENT, ({ payload }) => setPreferences(payload));
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const toggleShowHiddenFiles = useCallback(() => {
    invoke("app_preferences_set", {
      preferences: { ...preferences, showHiddenFiles: !preferences.showHiddenFiles },
    }).catch((error) => {
      pushNotification?.({ title: "Failed to save preferences", message: getErrorMessage(error), tone: "error" });
    });
  }, [preferences, pushNotification]);

  return { preferences, toggleShowHiddenFiles };
}
