use notify::{EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State};

type FilesystemWatcher = notify::RecommendedWatcher;

struct ManagedFilesystemWatcher {
  _watcher: FilesystemWatcher,
  canonical_path: PathBuf,
  window_label: String,
  watch_id: String,
}

#[derive(Serialize)]
pub struct DriveInfo {
  name: String,
  path: String,
}

#[derive(Clone, Serialize)]
pub struct FsEntry {
  name: String,
  path: String,
  is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsDirectoryPage {
  entries: Vec<FsEntry>,
  has_more: bool,
  total_count: usize,
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

const FILESYSTEM_WATCH_EVENT: &str = "filesystem-watch-event";

#[derive(Default)]
pub struct FilesystemWatchState {
  watchers: Mutex<HashMap<String, ManagedFilesystemWatcher>>,
}

#[derive(Default)]
pub struct FilesystemDirectoryListingState {
  listings: Mutex<HashMap<String, Vec<FsEntry>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilesystemWatchEventPayload {
  watch_id: String,
  changed_path: String,
}

#[cfg(target_os = "windows")]
const CROSS_DEVICE_ERROR_CODE: i32 = 17;
#[cfg(not(target_os = "windows"))]
const CROSS_DEVICE_ERROR_CODE: i32 = 18;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardModifierState {
  shift_key: bool,
  ctrl_key: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemClipboardState {
  mode: String,
  paths: Vec<String>,
}

#[cfg(target_os = "windows")]
const CLIPBOARD_DROPEFFECT_COPY: u32 = 1;
#[cfg(target_os = "windows")]
const CLIPBOARD_DROPEFFECT_MOVE: u32 = 2;

#[cfg(target_os = "windows")]
fn utf16_null_terminated(value: &str) -> Vec<u16> {
  value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn with_open_clipboard<T>(operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
  use windows_sys::Win32::System::DataExchange::{CloseClipboard, OpenClipboard};

  unsafe {
    if OpenClipboard(std::ptr::null_mut()) == 0 {
      return Err("Failed to open clipboard.".to_string());
    }
  }

  let result = operation();

  unsafe {
    CloseClipboard();
  }

  result
}

#[cfg(target_os = "windows")]
fn encode_clipboard_file_list(paths: &[PathBuf]) -> Vec<u16> {
  use std::os::windows::ffi::OsStrExt;

  let mut encoded = Vec::new();
  for path in paths {
    encoded.extend(path.as_os_str().encode_wide());
    encoded.push(0);
  }
  encoded.push(0);
  encoded
}

#[cfg(target_os = "windows")]
fn write_filesystem_clipboard_windows(paths: &[PathBuf], mode: &str) -> Result<(), String> {
  use std::mem::size_of;
  use windows_sys::Win32::Foundation::{GlobalFree, POINT};
  use windows_sys::Win32::System::DataExchange::{
    EmptyClipboard, RegisterClipboardFormatW, SetClipboardData,
  };
  use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
  use windows_sys::Win32::System::Ole::CF_HDROP;
  use windows_sys::Win32::UI::Shell::DROPFILES;

  let requested_drop_effect = if mode.eq_ignore_ascii_case("cut") {
    CLIPBOARD_DROPEFFECT_MOVE
  } else {
    CLIPBOARD_DROPEFFECT_COPY
  };

  with_open_clipboard(|| unsafe {
    if EmptyClipboard() == 0 {
      return Err("Failed to clear clipboard.".to_string());
    }

    if paths.is_empty() {
      return Ok(());
    }

    let encoded_paths = encode_clipboard_file_list(paths);
    let header_size = size_of::<DROPFILES>();
    let payload_size = encoded_paths.len() * size_of::<u16>();
    let global_size = header_size + payload_size;

    let dropfiles_handle = GlobalAlloc(GMEM_MOVEABLE, global_size);
    if dropfiles_handle.is_null() {
      return Err("Failed to allocate clipboard memory for file list.".to_string());
    }

    let dropfiles_ptr = GlobalLock(dropfiles_handle) as *mut u8;
    if dropfiles_ptr.is_null() {
      GlobalFree(dropfiles_handle);
      return Err("Failed to lock clipboard memory for file list.".to_string());
    }

    let dropfiles_header = dropfiles_ptr as *mut DROPFILES;
    (*dropfiles_header).pFiles = header_size as u32;
    (*dropfiles_header).pt = POINT { x: 0, y: 0 };
    (*dropfiles_header).fNC = 0;
    (*dropfiles_header).fWide = 1;

    let encoded_ptr = dropfiles_ptr.add(header_size) as *mut u16;
    std::ptr::copy_nonoverlapping(encoded_paths.as_ptr(), encoded_ptr, encoded_paths.len());
    GlobalUnlock(dropfiles_handle);

    if SetClipboardData(CF_HDROP as u32, dropfiles_handle) == std::ptr::null_mut() {
      GlobalFree(dropfiles_handle);
      return Err("Failed to set file list clipboard data.".to_string());
    }

    let format_name = utf16_null_terminated("Preferred DropEffect");
    let preferred_drop_effect_format = RegisterClipboardFormatW(format_name.as_ptr());
    if preferred_drop_effect_format != 0 {
      write_clipboard_drop_effect(preferred_drop_effect_format, requested_drop_effect);
    }

    Ok(())
  })
}

#[cfg(target_os = "windows")]
unsafe fn write_clipboard_drop_effect(format: u32, effect: u32) {
  use std::mem::size_of;
  use windows_sys::Win32::Foundation::GlobalFree;
  use windows_sys::Win32::System::DataExchange::SetClipboardData;
  use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

  let effect_handle = GlobalAlloc(GMEM_MOVEABLE, size_of::<u32>());
  if effect_handle.is_null() {
    return;
  }
  let effect_ptr = GlobalLock(effect_handle) as *mut u32;
  if effect_ptr.is_null() {
    GlobalFree(effect_handle);
    return;
  }
  *effect_ptr = effect;
  GlobalUnlock(effect_handle);
  if SetClipboardData(format, effect_handle) == std::ptr::null_mut() {
    GlobalFree(effect_handle);
  }
}

#[cfg(target_os = "windows")]
fn read_filesystem_clipboard_windows() -> Result<FilesystemClipboardState, String> {
  use std::ffi::OsString;
  use std::os::windows::ffi::OsStringExt;
  use windows_sys::Win32::System::DataExchange::{
    GetClipboardData, IsClipboardFormatAvailable, RegisterClipboardFormatW,
  };
  use windows_sys::Win32::System::Ole::CF_HDROP;
  use windows_sys::Win32::UI::Shell::{DragQueryFileW, HDROP};

  with_open_clipboard(|| unsafe {
    if IsClipboardFormatAvailable(CF_HDROP as u32) == 0 {
      return Ok(FilesystemClipboardState {
        mode: "".to_string(),
        paths: Vec::new(),
      });
    }

    let hdrop_handle = GetClipboardData(CF_HDROP as u32);
    if hdrop_handle.is_null() {
      return Ok(FilesystemClipboardState {
        mode: "".to_string(),
        paths: Vec::new(),
      });
    }

    let hdrop = hdrop_handle as HDROP;
    let file_count = DragQueryFileW(hdrop, 0xFFFF_FFFF, std::ptr::null_mut(), 0);
    let mut paths = Vec::with_capacity(file_count as usize);
    for index in 0..file_count {
      let path_len = DragQueryFileW(hdrop, index, std::ptr::null_mut(), 0);
      if path_len == 0 {
        continue;
      }

      let mut path_buffer = vec![0u16; path_len as usize + 1];
      let written = DragQueryFileW(hdrop, index, path_buffer.as_mut_ptr(), path_len + 1);
      if written == 0 {
        continue;
      }

      let path_os_string = OsString::from_wide(&path_buffer[..written as usize]);
      paths.push(path_os_string.to_string_lossy().to_string());
    }

    let format_name = utf16_null_terminated("Preferred DropEffect");
    let preferred_drop_effect_format = RegisterClipboardFormatW(format_name.as_ptr());
    let mode = read_clipboard_drop_mode(preferred_drop_effect_format);

    Ok(FilesystemClipboardState { mode, paths })
  })
}

#[cfg(target_os = "windows")]
unsafe fn read_clipboard_drop_mode(format: u32) -> String {
  use windows_sys::Win32::System::DataExchange::{GetClipboardData, IsClipboardFormatAvailable};
  use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};

  if format == 0 || IsClipboardFormatAvailable(format) == 0 {
    return "copy".to_string();
  }
  let effect_handle = GetClipboardData(format);
  if effect_handle.is_null() {
    return "copy".to_string();
  }
  let effect_ptr = GlobalLock(effect_handle) as *const u32;
  if effect_ptr.is_null() {
    return "copy".to_string();
  }
  let effect = *effect_ptr;
  GlobalUnlock(effect_handle);
  if (effect & CLIPBOARD_DROPEFFECT_MOVE) != 0 {
    "cut".to_string()
  } else {
    "copy".to_string()
  }
}

fn watch_state_key(window_label: &str, watch_id: &str) -> String {
  format!("{window_label}::{watch_id}")
}

fn is_watch_event_relevant(kind: &EventKind) -> bool {
  matches!(
    kind,
    EventKind::Any | EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
  )
}

fn create_filesystem_watcher<F>(event_handler: F) -> Result<FilesystemWatcher, String>
where
  F: FnMut(notify::Result<notify::Event>) + Send + 'static,
{
  notify::recommended_watcher(event_handler).map_err(|error| error.to_string())
}

fn create_emitting_filesystem_watcher(
  app_handle: tauri::AppHandle,
  watch_id: String,
) -> Result<FilesystemWatcher, String> {
  create_filesystem_watcher(move |event_result: notify::Result<notify::Event>| {
    let event = match event_result {
      Ok(event) => event,
      Err(_) => return,
    };

    if !is_watch_event_relevant(&event.kind) {
      return;
    }

    let changed_path = event
      .paths
      .first()
      .map(|entry_path| entry_path.to_string_lossy().to_string())
      .unwrap_or_default();

    let _ = app_handle.emit(
      FILESYSTEM_WATCH_EVENT,
      FilesystemWatchEventPayload {
        watch_id: watch_id.clone(),
        changed_path,
      },
    );
  })
}

fn sort_entries(entries: &mut [FsEntry]) {
  entries.sort_by_cached_key(|entry| (!entry.is_dir, entry.name.to_lowercase()));
}

fn read_sorted_directory_entries(path: &str) -> Result<Vec<FsEntry>, String> {
  let mut entries = Vec::new();
  let read_dir = fs::read_dir(path).map_err(|error| error.to_string())?;
  for entry_result in read_dir {
    let dir_entry = entry_result.map_err(|error| error.to_string())?;
    let entry_path = dir_entry.path();
    let name = dir_entry.file_name().to_string_lossy().to_string();
    let is_dir = dir_entry
      .file_type()
      .map_err(|error| error.to_string())?
      .is_dir();

    entries.push(FsEntry {
      name,
      path: entry_path.to_string_lossy().to_string(),
      is_dir,
    });
  }

  sort_entries(&mut entries);
  Ok(entries)
}

fn build_directory_page(entries: &[FsEntry], offset: usize, limit: usize) -> FsDirectoryPage {
  let normalized_limit = limit.clamp(1, 1024);
  let start = offset.min(entries.len());
  let end = (start + normalized_limit).min(entries.len());

  FsDirectoryPage {
    entries: entries[start..end].to_vec(),
    has_more: end < entries.len(),
    total_count: entries.len(),
  }
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

fn is_cross_device_error(error: &std::io::Error) -> bool {
  matches!(error.raw_os_error(), Some(code) if code == CROSS_DEVICE_ERROR_CODE)
}

fn remove_source_path(source_path: &Path) -> Result<(), String> {
  if source_path.is_dir() {
    fs::remove_dir_all(source_path).map_err(|error| error.to_string())?;
  } else {
    fs::remove_file(source_path).map_err(|error| error.to_string())?;
  }

  Ok(())
}

fn has_valid_extension_suffix(suffix: &str) -> bool {
  if suffix.is_empty() {
    return true;
  }
  if !suffix.starts_with('.') {
    return false;
  }
  suffix[1..].split('.').all(|segment| !segment.is_empty())
}

fn parse_incrementable_suffix(name: &str) -> Option<(String, u64, usize, String)> {
  let mut last_match: Option<(String, u64, usize, String)> = None;

  for (dot_index, character) in name.char_indices() {
    if character != '.' {
      continue;
    }

    let prefix = &name[..dot_index];
    if prefix.is_empty() {
      continue;
    }

    let remainder = &name[(dot_index + 1)..];
    let digits_len = remainder
      .chars()
      .take_while(|character| character.is_ascii_digit())
      .count();
    if digits_len < 3 {
      continue;
    }

    let digits = &remainder[..digits_len];
    let suffix = &remainder[digits_len..];
    if !has_valid_extension_suffix(suffix) {
      continue;
    }

    let number = digits.parse::<u64>().ok()?;
    last_match = Some((prefix.to_string(), number, digits.len(), suffix.to_string()));
  }

  last_match
}

fn split_name_for_fallback_suffix(name: &str) -> (String, String) {
  match name.rfind('.') {
    Some(dot_index) if dot_index > 0 => (
      name[..dot_index].to_string(),
      name[dot_index..].to_string(),
    ),
    _ => (name.to_string(), String::new()),
  }
}

fn build_next_collision_name(name: &str) -> String {
  if let Some((prefix, number, width, suffix)) = parse_incrementable_suffix(name) {
    let incremented = number.saturating_add(1);
    return format!("{prefix}.{incremented:0width$}{suffix}");
  }

  let (base_name, extension_suffix) = split_name_for_fallback_suffix(name);
  format!("{base_name}.001{extension_suffix}")
}

fn path_conflicts_with_existing(candidate_path: &Path, source_canonical_path: &Path) -> bool {
  if !candidate_path.exists() {
    return false;
  }

  match fs::canonicalize(candidate_path) {
    Ok(candidate_canonical_path) => candidate_canonical_path != source_canonical_path,
    Err(_) => true,
  }
}

fn is_same_or_descendant_path(path: &Path, root: &Path) -> bool {
  path == root || path.starts_with(root)
}

fn remap_path_prefix(path: &Path, source: &Path, destination: &Path) -> PathBuf {
  if path == source {
    return destination.to_path_buf();
  }

  match path.strip_prefix(source) {
    Ok(suffix) => destination.join(suffix),
    Err(_) => path.to_path_buf(),
  }
}

fn drain_watchers_in_path_tree(
  watchers: &mut HashMap<String, ManagedFilesystemWatcher>,
  source_canonical_path: &Path,
) -> Vec<ManagedFilesystemWatcher> {
  let keys_to_remove: Vec<String> = watchers
    .iter()
    .filter_map(|(key, watcher)| {
      is_same_or_descendant_path(&watcher.canonical_path, source_canonical_path)
        .then_some(key.clone())
    })
    .collect();

  let mut suspended = Vec::with_capacity(keys_to_remove.len());
  for key in keys_to_remove {
    if let Some(watcher) = watchers.remove(&key) {
      suspended.push(watcher);
    }
  }

  suspended
}

fn suspend_watchers_for_path(
  state: &State<FilesystemWatchState>,
  source_canonical_path: &Path,
) -> Result<Vec<ManagedFilesystemWatcher>, String> {
  let mut watchers = state
    .watchers
    .lock()
    .map_err(|_| "Failed to access filesystem watcher state.".to_string())?;
  Ok(drain_watchers_in_path_tree(&mut watchers, source_canonical_path))
}

fn restore_suspended_watchers(
  state: &State<FilesystemWatchState>,
  app_handle: &tauri::AppHandle,
  source_canonical_path: &Path,
  destination_canonical_path: &Path,
  suspended_watchers: Vec<ManagedFilesystemWatcher>,
) {
  let mut restored = Vec::new();
  for suspended in suspended_watchers {
    let remapped_path = remap_path_prefix(
      &suspended.canonical_path,
      source_canonical_path,
      destination_canonical_path,
    );

    let mut watcher = match create_emitting_filesystem_watcher(
      app_handle.clone(),
      suspended.watch_id.clone(),
    ) {
      Ok(watcher) => watcher,
      Err(error) => {
        eprintln!("[filesystem-watch] Failed to recreate watcher: {error}");
        continue;
      }
    };

    if let Err(error) = watcher.watch(&remapped_path, RecursiveMode::NonRecursive) {
      eprintln!(
        "[filesystem-watch] Failed to restore watcher for '{}': {}",
        remapped_path.to_string_lossy(),
        error
      );
      continue;
    }

    restored.push(ManagedFilesystemWatcher {
      _watcher: watcher,
      canonical_path: remapped_path,
      window_label: suspended.window_label,
      watch_id: suspended.watch_id,
    });
  }

  let mut watchers = match state.watchers.lock() {
    Ok(guard) => guard,
    Err(_) => {
      eprintln!("[filesystem-watch] Failed to reinsert restored watchers.");
      return;
    }
  };

  for watcher in restored {
    let watcher_key = watch_state_key(&watcher.window_label, &watcher.watch_id);
    watchers.insert(watcher_key, watcher);
  }
}

fn resolve_non_conflicting_name(
  parent_path: &Path,
  requested_name: &str,
  source_canonical_path: &Path,
) -> String {
  let mut candidate_name = requested_name.to_string();
  loop {
    let candidate_path = parent_path.join(&candidate_name);
    if !path_conflicts_with_existing(&candidate_path, source_canonical_path) {
      return candidate_name;
    }
    candidate_name = build_next_collision_name(&candidate_name);
  }
}

fn resolve_non_conflicting_create_name(parent_path: &Path, requested_name: &str) -> String {
  let mut candidate_name = requested_name.to_string();
  loop {
    let candidate_path = parent_path.join(&candidate_name);
    if !candidate_path.exists() {
      return candidate_name;
    }
    candidate_name = build_next_collision_name(&candidate_name);
  }
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

fn handle_move_rename_error(
  source_path: &Path,
  destination_path: &Path,
  rename_error: std::io::Error,
) -> Result<(), String> {
  if !is_cross_device_error(&rename_error) {
    return Err(rename_error.to_string());
  }

  copy_path_recursive(source_path, destination_path)?;
  remove_source_path(source_path)
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
pub fn list_directory(path: &str) -> Result<Vec<FsEntry>, String> {
  read_sorted_directory_entries(path)
}

#[tauri::command]
pub fn list_directory_page(
  state: State<FilesystemDirectoryListingState>,
  path: &str,
  offset: usize,
  limit: usize,
  refresh: Option<bool>,
) -> Result<FsDirectoryPage, String> {
  let normalized_path = path.trim();
  if normalized_path.is_empty() {
    return Err("A path is required.".to_string());
  }

  let cache_key = normalized_path.to_string();
  let should_refresh = refresh.unwrap_or(false);
  let mut listings = state
    .listings
    .lock()
    .map_err(|_| "Failed to access directory listing cache.".to_string())?;

  if should_refresh {
    listings.remove(&cache_key);
  }

  if !listings.contains_key(&cache_key) {
    let entries = read_sorted_directory_entries(normalized_path)?;
    listings.insert(cache_key.clone(), entries);
  }

  let cached_entries = listings
    .get(&cache_key)
    .expect("directory listing should be cached after insertion");

  Ok(build_directory_page(cached_entries, offset, limit))
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

#[tauri::command]
pub fn move_path(source: &str, destination_dir: &str) -> Result<(), String> {
  let source_path = PathBuf::from(source);
  let destination_dir_path = PathBuf::from(destination_dir);

  if !source_path.exists() {
    return Err("The source path does not exist.".to_string());
  }

  if !destination_dir_path.is_dir() {
    return Err("The destination must be an existing folder.".to_string());
  }

  let source_canonical = fs::canonicalize(&source_path).map_err(|error| error.to_string())?;
  let destination_canonical =
    fs::canonicalize(&destination_dir_path).map_err(|error| error.to_string())?;

  if source_canonical == destination_canonical {
    return Err("Cannot move a file or folder into itself.".to_string());
  }

  if source_canonical.is_dir() && destination_canonical.starts_with(&source_canonical) {
    return Err("Cannot move a folder into itself or one of its descendants.".to_string());
  }

  let source_name = source_path
    .file_name()
    .ok_or_else(|| "Cannot determine the item name for this path.".to_string())?;

  let destination_path = destination_dir_path.join(source_name);
  if destination_path.exists() {
    return Err(format!(
      "An item named '{}' already exists in the destination folder.",
      source_name.to_string_lossy()
    ));
  }

  match fs::rename(&source_path, &destination_path) {
    Ok(()) => Ok(()),
    Err(rename_error) => handle_move_rename_error(&source_path, &destination_path, rename_error),
  }
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

#[tauri::command]
pub fn delete_paths(paths: Vec<String>) -> Result<(), String> {
  let normalized_paths: Vec<PathBuf> = paths
    .into_iter()
    .filter_map(|path| (!path.trim().is_empty()).then_some(PathBuf::from(path)))
    .collect();

  if normalized_paths.is_empty() {
    return Err("No paths were provided for deletion.".to_string());
  }

  for path in normalized_paths {
    if !path.exists() {
      return Err(format!(
        "The path '{}' does not exist.",
        path.to_string_lossy()
      ));
    }
    trash::delete(&path).map_err(|error| error.to_string())?;
  }

  Ok(())
}

fn copy_path_recursive(source_path: &Path, destination_path: &Path) -> Result<(), String> {
  if source_path.is_dir() {
    fs::create_dir(destination_path).map_err(|error| error.to_string())?;

    let read_dir = fs::read_dir(source_path).map_err(|error| error.to_string())?;
    for entry in read_dir {
      let source_entry = entry.map_err(|error| error.to_string())?;
      let source_entry_path = source_entry.path();
      let destination_entry_path = destination_path.join(source_entry.file_name());
      copy_path_recursive(&source_entry_path, &destination_entry_path)?;
    }

    return Ok(());
  }

  fs::copy(source_path, destination_path)
    .map(|_| ())
    .map_err(|error| error.to_string())
}

fn import_single_path(source_path: &Path, destination_dir_path: &Path) -> Result<(), String> {
  if !source_path.exists() {
    return Err(format!(
      "The source path '{}' does not exist.",
      source_path.to_string_lossy()
    ));
  }

  let source_name = source_path
    .file_name()
    .ok_or_else(|| "Cannot determine the item name for this path.".to_string())?;
  let destination_path = destination_dir_path.join(source_name);

  if destination_path.exists() {
    return Err(format!(
      "An item named '{}' already exists in the destination folder.",
      source_name.to_string_lossy()
    ));
  }

  let source_canonical = fs::canonicalize(source_path).map_err(|error| error.to_string())?;
  let destination_canonical =
    fs::canonicalize(destination_dir_path).map_err(|error| error.to_string())?;

  if source_canonical == destination_canonical {
    return Err("Cannot import a file or folder into itself.".to_string());
  }

  if source_canonical.is_dir() && destination_canonical.starts_with(&source_canonical) {
    return Err("Cannot import a folder into itself or one of its descendants.".to_string());
  }

  copy_path_recursive(source_path, &destination_path)
}

#[tauri::command]
pub fn import_paths(paths: Vec<String>, destination_dir: &str) -> Result<(), String> {
  if paths.is_empty() {
    return Err("No paths were provided for import.".to_string());
  }

  let destination_dir_path = PathBuf::from(destination_dir);
  if !destination_dir_path.is_dir() {
    return Err("The destination must be an existing folder.".to_string());
  }

  for source in paths {
    let source_path = PathBuf::from(source);
    import_single_path(&source_path, &destination_dir_path)?;
  }

  Ok(())
}

#[tauri::command]
pub fn filesystem_watch_start(
  window: tauri::Window,
  state: State<FilesystemWatchState>,
  watch_id: &str,
  path: &str,
) -> Result<(), String> {
  let normalized_watch_id = watch_id.trim();
  if normalized_watch_id.is_empty() {
    return Err("A watcher id is required.".to_string());
  }

  let watch_path = PathBuf::from(path);
  if !watch_path.is_dir() {
    return Err("The watcher path must be an existing folder.".to_string());
  }

  let canonical_watch_path = fs::canonicalize(&watch_path).map_err(|error| error.to_string())?;
  let app_handle = window.app_handle().clone();
  let window_label = window.label().to_string();
  let watcher_key = watch_state_key(&window_label, normalized_watch_id);
  let watched_id = normalized_watch_id.to_string();

  let mut watcher = create_emitting_filesystem_watcher(app_handle, watched_id.clone())?;

  watcher
    .watch(&canonical_watch_path, RecursiveMode::NonRecursive)
    .map_err(|error| error.to_string())?;

  let mut watchers = state
    .watchers
    .lock()
    .map_err(|_| "Failed to access filesystem watcher state.".to_string())?;
  watchers.insert(
    watcher_key,
    ManagedFilesystemWatcher {
      _watcher: watcher,
      canonical_path: canonical_watch_path,
      window_label,
      watch_id: watched_id,
    },
  );
  Ok(())
}

#[tauri::command]
pub fn filesystem_watch_stop(
  window: tauri::Window,
  state: State<FilesystemWatchState>,
  watch_id: &str,
) -> Result<(), String> {
  let normalized_watch_id = watch_id.trim();
  if normalized_watch_id.is_empty() {
    return Ok(());
  }

  let mut watchers = state
    .watchers
    .lock()
    .map_err(|_| "Failed to access filesystem watcher state.".to_string())?;
  let watcher_key = watch_state_key(window.label(), normalized_watch_id);
  watchers.remove(&watcher_key);
  Ok(())
}

pub fn handle_filesystem_window_destroyed(state: &State<FilesystemWatchState>, window_label: &str) {
  let window_prefix = format!("{window_label}::");
  let mut watchers = match state.watchers.lock() {
    Ok(watchers) => watchers,
    Err(_) => return,
  };

  watchers.retain(|watcher_key, _| !watcher_key.starts_with(&window_prefix));
}

#[tauri::command]
pub fn keyboard_modifier_state() -> KeyboardModifierState {
  #[cfg(target_os = "windows")]
  {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_SHIFT};

    KeyboardModifierState {
      shift_key: unsafe { GetKeyState(VK_SHIFT as i32) } < 0,
      ctrl_key: unsafe { GetKeyState(VK_CONTROL as i32) } < 0,
    }
  }

  #[cfg(not(target_os = "windows"))]
  {
    KeyboardModifierState {
      shift_key: false,
      ctrl_key: false,
    }
  }
}

#[tauri::command]
pub fn filesystem_clipboard_set(paths: Vec<String>, mode: Option<String>) -> Result<(), String> {
  let normalized_paths: Vec<PathBuf> = paths
    .into_iter()
    .map(|path| path.trim().to_string())
    .filter(|path| !path.is_empty())
    .map(PathBuf::from)
    .collect();
  let normalized_mode = mode.unwrap_or_default().trim().to_lowercase();

  #[cfg(target_os = "windows")]
  {
    return write_filesystem_clipboard_windows(&normalized_paths, &normalized_mode);
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = normalized_paths;
    let _ = normalized_mode;
    Ok(())
  }
}

#[tauri::command]
pub fn filesystem_clipboard_get() -> Result<FilesystemClipboardState, String> {
  #[cfg(target_os = "windows")]
  {
    return read_filesystem_clipboard_windows();
  }

  #[cfg(not(target_os = "windows"))]
  {
    Ok(FilesystemClipboardState {
      mode: "".to_string(),
      paths: Vec::new(),
    })
  }
}

#[tauri::command]
pub fn start_external_drag(
  window: tauri::Window,
  paths: Vec<String>,
  mode: Option<String>,
) -> Result<(), String> {
  let normalized_paths: Vec<PathBuf> = paths
    .into_iter()
    .filter_map(|path| (!path.is_empty()).then_some(PathBuf::from(path)))
    .collect();

  if normalized_paths.is_empty() {
    return Err("No paths were provided for drag.".to_string());
  }

  let mut drag_paths = Vec::with_capacity(normalized_paths.len());
  for path in normalized_paths {
    drag_paths.push(fs::canonicalize(path).map_err(|error| error.to_string())?);
  }

  let source_paths_for_cleanup = drag_paths.clone();
  let drag_item = drag::DragItem::Files(drag_paths);
  let preview_icon = drag::Image::Raw(include_bytes!("../../icons/32x32.png").to_vec());
  let requested_move = mode.as_deref() == Some("move");
  let drag_options = drag::Options {
    mode: drag::DragMode::CopyMove,
    ..drag::Options::default()
  };
  drag::start_drag(
    #[cfg(target_os = "linux")]
    &window.gtk_window().map_err(|error| error.to_string())?,
    #[cfg(not(target_os = "linux"))]
    &window,
    drag_item,
    preview_icon,
    move |drag_result, _cursor_position| {
      if requested_move && matches!(drag_result, drag::DragResult::Dropped) {
        for source_path in &source_paths_for_cleanup {
          let _ = remove_source_path(source_path);
        }
      }
    },
    drag_options,
  )
  .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests;
