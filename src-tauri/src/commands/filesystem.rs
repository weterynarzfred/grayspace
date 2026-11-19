use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

mod clipboard;
mod external_dnd;
mod listing;
mod naming;
mod search;
mod shell_menu;
mod transfer;
mod watcher;

pub use clipboard::{filesystem_clipboard_get, filesystem_clipboard_set};
pub use external_dnd::{keyboard_modifier_state, start_external_drag};
pub use listing::{list_directory, list_directory_page, FilesystemDirectoryListingState};
pub use search::{
  filesystem_existing_paths, filesystem_search_cancel, filesystem_search_start,
  handle_search_window_destroyed,
  FilesystemSearchState,
};
pub use shell_menu::filesystem_show_shell_menu;
pub use transfer::{
  delete_paths, filesystem_transfer_cancel, filesystem_transfer_conflicts, import_paths, move_path,
  recreate_folders, remove_empty_folders, FilesystemTransferState,
};
pub use watcher::{
  filesystem_watch_start, filesystem_watch_stop, handle_filesystem_window_destroyed,
  FilesystemWatchState,
};
use naming::{
  path_conflicts_with_existing, resolve_non_conflicting_create_name, resolve_non_conflicting_name,
};
use watcher::{restore_suspended_watchers, suspend_watchers_for_path};

#[derive(Serialize)]
pub struct DriveInfo {
  name: String,
  path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsPathProperties {
  path: String,
  size_bytes: Option<u64>,
  entry_type: String,
  date_modified_ms: Option<u64>,
  date_created_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePathResult {
  path: String,
  name: String,
  requested_name: String,
  adjusted: bool,
}

fn infer_entry_type(path: &Path, is_dir: bool) -> String {
  if is_dir {
    return "Folder".to_string();
  }

  path
    .extension()
    .and_then(|extension| extension.to_str())
    .map(str::trim)
    .filter(|extension| !extension.is_empty())
    .map(|extension| format!("{} file", extension.to_uppercase()))
    .unwrap_or_else(|| "File".to_string())
}

fn system_time_to_epoch_millis(value: Result<SystemTime, std::io::Error>) -> Option<u64> {
  value.ok().and_then(|time| {
    time
      .duration_since(UNIX_EPOCH)
      .ok()
      .and_then(|duration| u64::try_from(duration.as_millis()).ok())
  })
}

fn create_path_core(
  parent_dir: &str,
  name: &str,
  should_create_directory: bool,
  allow_adjustment: Option<bool>,
) -> Result<RenamePathResult, String> {
  let normalized_parent_dir = parent_dir.trim();
  let normalized_name = name.trim();
  let should_allow_adjustment = allow_adjustment.unwrap_or(true);

  if normalized_parent_dir.is_empty() {
    return Err("A parent directory path is required.".to_string());
  }
  if normalized_name.is_empty() {
    return Err("A name is required.".to_string());
  }
  if normalized_name.contains('\\') || normalized_name.contains('/') {
    return Err("The name cannot contain path separators.".to_string());
  }
  if normalized_name == "." || normalized_name == ".." {
    return Err("The name cannot be '.' or '..'.".to_string());
  }

  let parent_path = PathBuf::from(normalized_parent_dir);
  if !parent_path.is_dir() {
    return Err("The parent path must be an existing folder.".to_string());
  }

  let resolved_name = if should_allow_adjustment {
    resolve_non_conflicting_create_name(&parent_path, normalized_name)
  } else {
    let candidate_path = parent_path.join(normalized_name);
    if candidate_path.exists() {
      return Err(format!(
        "An item named '{}' already exists in this folder.",
        normalized_name
      ));
    }
    normalized_name.to_string()
  };

  let destination_path = parent_path.join(&resolved_name);
  if should_create_directory {
    fs::create_dir(&destination_path).map_err(|error| error.to_string())?;
  } else {
    fs::write(&destination_path, "").map_err(|error| error.to_string())?;
  }

  Ok(RenamePathResult {
    path: destination_path.to_string_lossy().to_string(),
    name: resolved_name.clone(),
    requested_name: normalized_name.to_string(),
    adjusted: resolved_name != normalized_name,
  })
}

#[tauri::command]
pub fn list_drives() -> Vec<DriveInfo> {
  #[cfg(target_os = "windows")]
  {
    (b'A'..=b'Z')
      .filter_map(|letter| {
        let name = format!("{}:", letter as char);
        let path = format!("{name}\\");
        if Path::new(&path).is_dir() {
          Some(DriveInfo { name, path })
        } else {
          None
        }
      })
      .collect()
  }

  #[cfg(not(target_os = "windows"))]
  {
    vec![DriveInfo {
      name: "/".to_string(),
      path: "/".to_string(),
    }]
  }
}

#[tauri::command]
pub fn filesystem_resolve_workspace_folders(paths: Vec<String>) -> HashMap<String, bool> {
  let mut result = HashMap::new();

  for raw_path in paths {
    let trimmed_path = raw_path.trim();
    if trimmed_path.is_empty() {
      continue;
    }

    let folder_path = PathBuf::from(trimmed_path);
    let has_workspace_folder = folder_path.is_dir() && folder_path.join(".grayspace").is_dir();
    result.insert(trimmed_path.to_string(), has_workspace_folder);
  }

  result
}

#[tauri::command]
pub fn filesystem_get_properties(path: &str) -> Result<FsPathProperties, String> {
  let normalized_path = path.trim();
  if normalized_path.is_empty() {
    return Err("A path is required.".to_string());
  }

  let target_path = PathBuf::from(normalized_path);
  if !target_path.exists() {
    return Err(format!("The path '{}' does not exist.", normalized_path));
  }

  let metadata = fs::metadata(&target_path).map_err(|error| error.to_string())?;
  let is_dir = metadata.is_dir();

  Ok(FsPathProperties {
    path: normalized_path.to_string(),
    size_bytes: (!is_dir).then_some(metadata.len()),
    entry_type: infer_entry_type(&target_path, is_dir),
    date_modified_ms: system_time_to_epoch_millis(metadata.modified()),
    date_created_ms: system_time_to_epoch_millis(metadata.created()),
  })
}

#[tauri::command]
pub fn parent_path(path: &str) -> Option<String> {
  Path::new(path)
    .parent()
    .map(|parent| parent.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_path(path: &str) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    Command::new("cmd")
      .args(["/C", "start", "", path])
      .spawn()
      .map_err(|error| error.to_string())?;
    return Ok(());
  }

  #[cfg(target_os = "macos")]
  {
    Command::new("open")
      .arg(path)
      .spawn()
      .map_err(|error| error.to_string())?;
    return Ok(());
  }

  #[cfg(all(unix, not(target_os = "macos")))]
  {
    Command::new("xdg-open")
      .arg(path)
      .spawn()
      .map_err(|error| error.to_string())?;
    return Ok(());
  }

  #[allow(unreachable_code)]
  Err("Opening paths is not supported on this platform.".to_string())
}

fn rename_path_core(
  path: &str,
  new_name: &str,
  allow_adjustment: Option<bool>,
) -> Result<RenamePathResult, String> {
  let normalized_path = path.trim();
  let normalized_name = new_name.trim();
  let should_allow_adjustment = allow_adjustment.unwrap_or(true);

  if normalized_path.is_empty() {
    return Err("A path is required.".to_string());
  }
  if normalized_name.is_empty() {
    return Err("A new name is required.".to_string());
  }
  if normalized_name.contains('\\') || normalized_name.contains('/') {
    return Err("The new name cannot contain path separators.".to_string());
  }
  if normalized_name == "." || normalized_name == ".." {
    return Err("The new name cannot be '.' or '..'.".to_string());
  }

  let source_path = PathBuf::from(normalized_path);
  if !source_path.exists() {
    return Err("The source path does not exist.".to_string());
  }

  let parent_path = source_path
    .parent()
    .ok_or_else(|| "Failed to resolve parent folder for this path.".to_string())?;
  let source_canonical_path = fs::canonicalize(&source_path).map_err(|error| error.to_string())?;

  let source_name = source_path
    .file_name()
    .and_then(|file_name| file_name.to_str())
    .ok_or_else(|| "Failed to resolve source name.".to_string())?;
  if source_name == normalized_name {
    return Ok(RenamePathResult {
      path: source_path.to_string_lossy().to_string(),
      name: source_name.to_string(),
      requested_name: normalized_name.to_string(),
      adjusted: false,
    });
  }

  let resolved_name = if should_allow_adjustment {
    resolve_non_conflicting_name(parent_path, normalized_name, &source_canonical_path)
  } else {
    let candidate_path = parent_path.join(normalized_name);
    if path_conflicts_with_existing(&candidate_path, &source_canonical_path) {
      return Err(format!(
        "An item named '{}' already exists in this folder.",
        normalized_name
      ));
    }
    normalized_name.to_string()
  };
  let destination_path = parent_path.join(&resolved_name);

  if destination_path != source_path {
    fs::rename(&source_path, &destination_path).map_err(|error| error.to_string())?;
  }

  Ok(RenamePathResult {
    path: destination_path.to_string_lossy().to_string(),
    name: resolved_name.clone(),
    requested_name: normalized_name.to_string(),
    adjusted: resolved_name != normalized_name,
  })
}

#[tauri::command]
pub fn rename_path(
  window: tauri::Window,
  watch_state: State<FilesystemWatchState>,
  path: &str,
  new_name: &str,
  allow_adjustment: Option<bool>,
) -> Result<RenamePathResult, String> {
  let normalized_path = path.trim();
  if normalized_path.is_empty() {
    return Err("A path is required.".to_string());
  }

  let source_path = PathBuf::from(normalized_path);
  if !source_path.exists() || !source_path.is_dir() {
    return rename_path_core(path, new_name, allow_adjustment);
  }

  let source_canonical_path = fs::canonicalize(&source_path).map_err(|error| error.to_string())?;
  let suspended_watchers = suspend_watchers_for_path(&watch_state, &source_canonical_path)?;
  let rename_result = rename_path_core(path, new_name, allow_adjustment);

  let destination_canonical_path = rename_result
    .as_ref()
    .ok()
    .and_then(|result| fs::canonicalize(&result.path).ok())
    .unwrap_or_else(|| source_canonical_path.clone());

  restore_suspended_watchers(
    &watch_state,
    &window.app_handle(),
    &source_canonical_path,
    &destination_canonical_path,
    suspended_watchers,
  );

  rename_result
}

#[tauri::command]
pub fn create_text_file(
  parent_dir: &str,
  name: &str,
  allow_adjustment: Option<bool>,
) -> Result<RenamePathResult, String> {
  create_path_core(parent_dir, name, false, allow_adjustment)
}

#[tauri::command]
pub fn create_folder(
  parent_dir: &str,
  name: &str,
  allow_adjustment: Option<bool>,
) -> Result<RenamePathResult, String> {
  create_path_core(parent_dir, name, true, allow_adjustment)
}

#[cfg(test)]
mod tests;
