use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFolderEntry {
  path: String,
  opened_at_ms: u64,
  #[serde(default)]
  is_workspace: bool,
}

const RECENT_FOLDERS_FILE_NAME: &str = "recent-folders.json";
const MAX_RECENT_FOLDERS: usize = 200;

fn recent_folders_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
  let app_data_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|error| error.to_string())?;
  fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
  Ok(app_data_dir.join(RECENT_FOLDERS_FILE_NAME))
}

pub(super) fn normalize_recent_folder_path(path: &str) -> String {
  let normalized_path = path.trim();
  if normalized_path.is_empty() {
    return String::new();
  }

  let mut trimmed_path = normalized_path.to_string();
  while trimmed_path.ends_with('\\') || trimmed_path.ends_with('/') {
    #[cfg(target_os = "windows")]
    {
      let bytes = trimmed_path.as_bytes();
      if bytes.len() == 3 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/') {
        break;
      }
    }

    #[cfg(not(target_os = "windows"))]
    {
      if trimmed_path == "/" {
        break;
      }
    }

    trimmed_path.pop();
  }

  trimmed_path
}

pub(super) fn recent_folder_dedupe_key(path: &str) -> String {
  let normalized_path = normalize_recent_folder_path(path);

  #[cfg(target_os = "windows")]
  {
    normalized_path.replace('/', "\\").to_lowercase()
  }

  #[cfg(not(target_os = "windows"))]
  {
    normalized_path
  }
}

fn read_recent_folders(app_handle: &AppHandle) -> Vec<RecentFolderEntry> {
  let recent_folders_path = match recent_folders_path(app_handle) {
    Ok(path) => path,
    Err(_) => return Vec::new(),
  };
  if !recent_folders_path.is_file() {
    return Vec::new();
  }

  let raw_recent_folders = match fs::read_to_string(recent_folders_path) {
    Ok(raw) => raw,
    Err(_) => return Vec::new(),
  };
  if raw_recent_folders.trim().is_empty() {
    return Vec::new();
  }

  serde_json::from_str::<Vec<RecentFolderEntry>>(&raw_recent_folders).unwrap_or_default()
}

fn sort_recent_folders(entries: &mut [RecentFolderEntry]) {
  entries.sort_by(|left, right| {
    right
      .opened_at_ms
      .cmp(&left.opened_at_ms)
      .then_with(|| left.path.cmp(&right.path))
  });
}

fn persist_recent_folders(app_handle: &AppHandle, entries: &[RecentFolderEntry]) -> Result<(), String> {
  let recent_folders_path = recent_folders_path(app_handle)?;
  let serialized_recent_folders = serde_json::to_string_pretty(entries)
    .map_err(|error| error.to_string())?;
  fs::write(recent_folders_path, serialized_recent_folders).map_err(|error| error.to_string())
}

fn current_unix_timestamp_ms() -> u64 {
  let now = SystemTime::now();
  now
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis() as u64
}

fn is_workspace_folder_path(path: &str) -> bool {
  if path.is_empty() {
    return false;
  }
  PathBuf::from(path).join(".grayspace").is_dir()
}

pub(super) fn record_recent_folder_open(app_handle: &AppHandle, path: &str) -> Result<(), String> {
  let normalized_path = normalize_recent_folder_path(path);
  if normalized_path.is_empty() {
    return Ok(());
  }

  let dedupe_key = recent_folder_dedupe_key(&normalized_path);
  if dedupe_key.is_empty() {
    return Ok(());
  }

  let mut entries = read_recent_folders(app_handle)
    .into_iter()
    .filter(|entry| recent_folder_dedupe_key(&entry.path) != dedupe_key)
    .collect::<Vec<_>>();
  let is_workspace = is_workspace_folder_path(&normalized_path);
  entries.push(RecentFolderEntry {
    path: normalized_path,
    opened_at_ms: current_unix_timestamp_ms(),
    is_workspace,
  });
  sort_recent_folders(&mut entries);
  if entries.len() > MAX_RECENT_FOLDERS {
    entries.truncate(MAX_RECENT_FOLDERS);
  }
  persist_recent_folders(app_handle, &entries)
}

#[tauri::command]
pub fn workspace_recent_folders_list(app_handle: AppHandle) -> Result<Vec<RecentFolderEntry>, String> {
  let mut entries = read_recent_folders(&app_handle)
    .into_iter()
    .filter_map(|entry| {
      let path = normalize_recent_folder_path(&entry.path);
      if path.is_empty() {
        return None;
      }
      Some(RecentFolderEntry {
        path,
        opened_at_ms: entry.opened_at_ms,
        is_workspace: entry.is_workspace,
      })
    })
    .collect::<Vec<_>>();
  sort_recent_folders(&mut entries);
  Ok(entries)
}

#[tauri::command]
pub fn workspace_recent_folders_record(app_handle: AppHandle, path: String) -> Result<(), String> {
  record_recent_folder_open(&app_handle, &path)
}

#[tauri::command]
pub fn workspace_recent_folders_remove(app_handle: AppHandle, path: String) -> Result<(), String> {
  let dedupe_key = recent_folder_dedupe_key(&path);
  if dedupe_key.is_empty() {
    return Ok(());
  }

  let mut entries = read_recent_folders(&app_handle)
    .into_iter()
    .filter(|entry| recent_folder_dedupe_key(&entry.path) != dedupe_key)
    .collect::<Vec<_>>();
  sort_recent_folders(&mut entries);
  if entries.len() > MAX_RECENT_FOLDERS {
    entries.truncate(MAX_RECENT_FOLDERS);
  }
  persist_recent_folders(&app_handle, &entries)
}

#[cfg(test)]
mod tests;
