use super::super::types::default_filesystem_sort_key;
use super::recent_folders::{normalize_recent_folder_path, recent_folder_dedupe_key};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const FOLDER_VIEW_STYLES_FILE_NAME: &str = "folder-view-styles.json";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderViewStyle {
  view_type: String,
  thumbnail_size_px: u32,
  #[serde(default = "default_filesystem_sort_key")]
  sort_key: String,
  #[serde(default)]
  sort_descending: bool,
}

fn folder_view_styles_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
  let app_data_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|error| error.to_string())?;
  fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
  Ok(app_data_dir.join(FOLDER_VIEW_STYLES_FILE_NAME))
}

fn folder_view_style_key(path: &str) -> Option<String> {
  let normalized = normalize_recent_folder_path(path);
  (!normalized.is_empty()).then(|| recent_folder_dedupe_key(&normalized))
}

fn read_folder_view_styles(path: &Path) -> BTreeMap<String, FolderViewStyle> {
  fs::read_to_string(path)
    .ok()
    .and_then(|raw| serde_json::from_str(&raw).ok())
    .unwrap_or_default()
}

fn write_folder_view_styles(path: &Path, styles: &BTreeMap<String, FolderViewStyle>) -> Result<(), String> {
  let serialized = serde_json::to_string_pretty(styles).map_err(|error| error.to_string())?;
  fs::write(path, serialized).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_folder_view_styles_get(app_handle: AppHandle, path: String) -> Option<FolderViewStyle> {
  let key = folder_view_style_key(&path)?;
  let styles_path = folder_view_styles_path(&app_handle).ok()?;
  read_folder_view_styles(&styles_path).remove(&key)
}

#[tauri::command]
pub fn workspace_folder_view_styles_set(
  app_handle: AppHandle,
  path: String,
  style: FolderViewStyle,
) -> Result<(), String> {
  let Some(key) = folder_view_style_key(&path) else {
    return Ok(());
  };
  let styles_path = folder_view_styles_path(&app_handle)?;
  let mut styles = read_folder_view_styles(&styles_path);
  styles.insert(key, style);
  write_folder_view_styles(&styles_path, &styles)
}

#[cfg(test)]
mod tests;
