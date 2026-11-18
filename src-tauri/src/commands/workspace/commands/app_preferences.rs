use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

const APP_PREFERENCES_FILE_NAME: &str = "app-preferences.json";
const APP_PREFERENCES_UPDATED_EVENT: &str = "app-preferences-updated";

/// Settings shared by every window. Fields missing from the file keep their defaults.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppPreferences {
  show_hidden_files: bool,
}

impl Default for AppPreferences {
  fn default() -> Self {
    Self { show_hidden_files: true }
  }
}

fn app_preferences_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
  let app_data_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|error| error.to_string())?;
  fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
  Ok(app_data_dir.join(APP_PREFERENCES_FILE_NAME))
}

fn read_app_preferences(path: &Path) -> AppPreferences {
  fs::read_to_string(path)
    .ok()
    .and_then(|raw| serde_json::from_str(&raw).ok())
    .unwrap_or_default()
}

fn write_app_preferences(path: &Path, preferences: &AppPreferences) -> Result<(), String> {
  let serialized = serde_json::to_string_pretty(preferences).map_err(|error| error.to_string())?;
  fs::write(path, serialized).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn app_preferences_get(app_handle: AppHandle) -> AppPreferences {
  app_preferences_path(&app_handle)
    .map(|path| read_app_preferences(&path))
    .unwrap_or_default()
}

/// Every window, including the caller, picks up the change from the broadcast.
#[tauri::command]
pub fn app_preferences_set(app_handle: AppHandle, preferences: AppPreferences) -> Result<(), String> {
  write_app_preferences(&app_preferences_path(&app_handle)?, &preferences)?;
  let _ = app_handle.emit(APP_PREFERENCES_UPDATED_EVENT, &preferences);
  Ok(())
}

#[cfg(test)]
mod tests;
