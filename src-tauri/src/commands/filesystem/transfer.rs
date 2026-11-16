use super::naming::resolve_non_conflicting_create_name;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, State};

const FILESYSTEM_TRANSFER_PROGRESS_EVENT: &str = "filesystem-transfer-progress";
const PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(100);
pub(super) const TRANSFER_CANCELLED_ERROR: &str = "The transfer was cancelled.";

#[cfg(target_os = "windows")]
const CROSS_DEVICE_ERROR_CODE: i32 = 17;
#[cfg(not(target_os = "windows"))]
const CROSS_DEVICE_ERROR_CODE: i32 = 18;

/// What to do when the destination folder already has an item with the same name.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ConflictPolicy {
  #[default]
  Fail,
  KeepBoth,
  /// The existing item goes to the Recycle Bin first; folders are replaced, not merged.
  Replace,
}

#[derive(Default)]
pub struct FilesystemTransferState {
  cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferProgressPayload {
  job_id: String,
  bytes_done: u64,
  bytes_total: u64,
  items_done: usize,
  items_total: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPathsResult {
  pub(super) copied_paths: Vec<String>,
  skipped_paths: Vec<String>,
}

/// Byte and item counters for one command call, emitted as throttled progress events when the
/// call belongs to a job. Long copies check `cancelled` between files and inside large files.
pub(super) struct TransferProgress {
  emitter: Option<(tauri::Window, String)>,
  cancelled: Arc<AtomicBool>,
  bytes_done: u64,
  bytes_total: u64,
  items_done: usize,
  items_total: usize,
  last_emit: Instant,
}

impl TransferProgress {
  pub(super) fn silent() -> Self {
    Self {
      emitter: None,
      cancelled: Arc::new(AtomicBool::new(false)),
      bytes_done: 0,
      bytes_total: 0,
      items_done: 0,
      items_total: 0,
      last_emit: Instant::now(),
    }
  }

  fn is_cancelled(&self) -> bool {
    self.cancelled.load(Ordering::Relaxed)
  }

  fn check_cancelled(&self) -> Result<(), String> {
    if self.is_cancelled() {
      Err(TRANSFER_CANCELLED_ERROR.to_string())
    } else {
      Ok(())
    }
  }

  fn add_bytes(&mut self, bytes: u64) {
    self.bytes_done += bytes;
    self.emit(false);
  }

  fn finish_item(&mut self) {
    self.items_done += 1;
    self.emit(true);
  }

  fn emit(&mut self, force: bool) {
    let Some((window, job_id)) = &self.emitter else {
      return;
    };
    if !force && self.last_emit.elapsed() < PROGRESS_EMIT_INTERVAL {
      return;
    }
    self.last_emit = Instant::now();
    let _ = window.emit(FILESYSTEM_TRANSFER_PROGRESS_EVENT, TransferProgressPayload {
      job_id: job_id.clone(),
      bytes_done: self.bytes_done,
      bytes_total: self.bytes_total,
      items_done: self.items_done,
      items_total: self.items_total,
    });
  }
}

fn start_job_progress(
  window: tauri::Window,
  state: &FilesystemTransferState,
  job_id: Option<String>,
  items_total: usize,
) -> TransferProgress {
  let mut progress = TransferProgress::silent();
  progress.items_total = items_total;
  if let Some(job_id) = job_id {
    if let Ok(mut cancel_flags) = state.cancel_flags.lock() {
      cancel_flags.insert(job_id.clone(), progress.cancelled.clone());
    }
    progress.emitter = Some((window, job_id));
  }
  progress
}

fn finish_job(state: &FilesystemTransferState, progress: &TransferProgress) {
  let Some((_, job_id)) = &progress.emitter else {
    return;
  };
  if let Ok(mut cancel_flags) = state.cancel_flags.lock() {
    cancel_flags.remove(job_id);
  }
}

fn is_cross_device_error(error: &std::io::Error) -> bool {
  matches!(error.raw_os_error(), Some(code) if code == CROSS_DEVICE_ERROR_CODE)
}

fn remove_path(path: &Path) -> Result<(), String> {
  if path.is_dir() {
    fs::remove_dir_all(path).map_err(|error| error.to_string())
  } else {
    fs::remove_file(path).map_err(|error| error.to_string())
  }
}

fn measure_bytes(path: &Path) -> u64 {
  if !path.is_dir() {
    return fs::metadata(path).map(|metadata| metadata.len()).unwrap_or(0);
  }
  fs::read_dir(path)
    .map(|read_dir| read_dir.flatten().map(|entry| measure_bytes(&entry.path())).sum())
    .unwrap_or(0)
}

#[cfg(target_os = "windows")]
fn copy_file_with_progress(
  source_path: &Path,
  destination_path: &Path,
  progress: &mut TransferProgress,
) -> Result<(), String> {
  use std::os::windows::ffi::OsStrExt;
  use windows_sys::Win32::Foundation::HANDLE;
  use windows_sys::Win32::Storage::FileSystem::{
    CopyFileExW, COPY_FILE_FAIL_IF_EXISTS, PROGRESS_CANCEL, PROGRESS_CONTINUE,
  };

  struct CopyState<'a> {
    progress: &'a mut TransferProgress,
    reported_bytes: u64,
  }

  unsafe extern "system" fn on_copy_progress(
    _total_file_size: i64,
    total_bytes_transferred: i64,
    _stream_size: i64,
    _stream_bytes_transferred: i64,
    _stream_number: u32,
    _callback_reason: u32,
    _source_file: HANDLE,
    _destination_file: HANDLE,
    data: *const std::ffi::c_void,
  ) -> u32 {
    let state = unsafe { &mut *(data as *mut CopyState) };
    let transferred = total_bytes_transferred as u64;
    state.progress.add_bytes(transferred.saturating_sub(state.reported_bytes));
    state.reported_bytes = transferred;
    if state.progress.is_cancelled() { PROGRESS_CANCEL } else { PROGRESS_CONTINUE }
  }

  // Canonicalized (verbatim) paths lift the 260-character limit, like std's own fs::copy.
  let source_verbatim = fs::canonicalize(source_path).map_err(|error| error.to_string())?;
  let destination_verbatim = match (destination_path.parent(), destination_path.file_name()) {
    (Some(parent), Some(name)) => fs::canonicalize(parent).map_err(|error| error.to_string())?.join(name),
    _ => destination_path.to_path_buf(),
  };
  let wide = |path: &Path| path.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<u16>>();
  let (source_wide, destination_wide) = (wide(&source_verbatim), wide(&destination_verbatim));
  let mut state = CopyState { progress, reported_bytes: 0 };
  // Copies attributes and timestamps like Explorer; a cancelled copy deletes the partial file.
  let copied = unsafe {
    CopyFileExW(
      source_wide.as_ptr(),
      destination_wide.as_ptr(),
      Some(on_copy_progress),
      &mut state as *mut CopyState as *const std::ffi::c_void,
      std::ptr::null_mut(),
      COPY_FILE_FAIL_IF_EXISTS,
    )
  };
  if copied != 0 {
    return Ok(());
  }
  state.progress.check_cancelled()?;
  Err(std::io::Error::last_os_error().to_string())
}

#[cfg(not(target_os = "windows"))]
fn copy_file_with_progress(
  source_path: &Path,
  destination_path: &Path,
  progress: &mut TransferProgress,
) -> Result<(), String> {
  let copied_bytes = fs::copy(source_path, destination_path).map_err(|error| error.to_string())?;
  progress.add_bytes(copied_bytes);
  Ok(())
}

pub(super) fn copy_path_recursive(
  source_path: &Path,
  destination_path: &Path,
  progress: &mut TransferProgress,
) -> Result<(), String> {
  progress.check_cancelled()?;
  if !source_path.is_dir() {
    return copy_file_with_progress(source_path, destination_path, progress);
  }

  fs::create_dir(destination_path).map_err(|error| error.to_string())?;
  let read_dir = fs::read_dir(source_path).map_err(|error| error.to_string())?;
  for entry in read_dir {
    let source_entry = entry.map_err(|error| error.to_string())?;
    copy_path_recursive(
      &source_entry.path(),
      &destination_path.join(source_entry.file_name()),
      progress,
    )?;
  }
  Ok(())
}

fn validate_transfer(source_path: &Path, destination_dir_path: &Path, verb: &str) -> Result<(), String> {
  if !source_path.exists() {
    return Err(format!("The source path '{}' does not exist.", source_path.to_string_lossy()));
  }
  if !destination_dir_path.is_dir() {
    return Err("The destination must be an existing folder.".to_string());
  }

  let source_canonical = fs::canonicalize(source_path).map_err(|error| error.to_string())?;
  let destination_canonical = fs::canonicalize(destination_dir_path).map_err(|error| error.to_string())?;
  if source_canonical == destination_canonical {
    return Err(format!("Cannot {verb} a file or folder into itself."));
  }
  if source_canonical.is_dir() && destination_canonical.starts_with(&source_canonical) {
    return Err(format!("Cannot {verb} a folder into itself or one of its descendants."));
  }
  Ok(())
}

/// Where the item should land, or None when a move finds it already there. Copying an item into
/// its own folder always keeps both.
fn resolve_destination(
  source_path: &Path,
  destination_dir_path: &Path,
  policy: ConflictPolicy,
  is_copy: bool,
) -> Result<Option<PathBuf>, String> {
  let source_name = source_path
    .file_name()
    .ok_or_else(|| "Cannot determine the item name for this path.".to_string())?;
  let destination_path = destination_dir_path.join(source_name);
  if !destination_path.exists() {
    return Ok(Some(destination_path));
  }

  let is_same_item = fs::canonicalize(&destination_path).ok() == fs::canonicalize(source_path).ok();
  let effective_policy = if is_same_item && is_copy { ConflictPolicy::KeepBoth } else { policy };
  if is_same_item && !is_copy {
    return Ok(None);
  }

  match effective_policy {
    ConflictPolicy::Fail => Err(format!(
      "An item named '{}' already exists in the destination folder.",
      source_name.to_string_lossy()
    )),
    ConflictPolicy::KeepBoth => Ok(Some(destination_dir_path.join(resolve_non_conflicting_create_name(
      destination_dir_path,
      &source_name.to_string_lossy(),
    )))),
    ConflictPolicy::Replace => {
      trash::delete(&destination_path).map_err(|error| error.to_string())?;
      Ok(Some(destination_path))
    }
  }
}

/// Renames when possible; across drives it copies with progress (see `move_across_devices`).
pub(super) fn move_item(
  source_path: &Path,
  destination_dir_path: &Path,
  policy: ConflictPolicy,
  progress: &mut TransferProgress,
) -> Result<Option<PathBuf>, String> {
  validate_transfer(source_path, destination_dir_path, "move")?;
  let Some(destination_path) = resolve_destination(source_path, destination_dir_path, policy, false)? else {
    return Ok(None);
  };

  match fs::rename(source_path, &destination_path) {
    Ok(()) => Ok(Some(destination_path)),
    Err(rename_error) if is_cross_device_error(&rename_error) => {
      move_across_devices(source_path, &destination_path, progress)?;
      Ok(Some(destination_path))
    }
    Err(rename_error) => Err(rename_error.to_string()),
  }
}

/// Removes the source only after the copy finished; a failed or cancelled copy is cleaned up.
pub(super) fn move_across_devices(
  source_path: &Path,
  destination_path: &Path,
  progress: &mut TransferProgress,
) -> Result<(), String> {
  progress.bytes_total += measure_bytes(source_path);
  if let Err(copy_error) = copy_path_recursive(source_path, destination_path, progress) {
    let _ = remove_path(destination_path);
    return Err(copy_error);
  }
  remove_path(source_path)
}

pub(super) fn copy_item(
  source_path: &Path,
  destination_dir_path: &Path,
  policy: ConflictPolicy,
  progress: &mut TransferProgress,
) -> Result<Option<PathBuf>, String> {
  validate_transfer(source_path, destination_dir_path, "copy")?;
  let Some(destination_path) = resolve_destination(source_path, destination_dir_path, policy, true)? else {
    return Ok(None);
  };
  copy_path_recursive(source_path, &destination_path, progress)?;
  Ok(Some(destination_path))
}

/// Source paths whose name is already taken in the destination folder. Copies into the item's own
/// folder and moves to where the item already is are not conflicts.
#[tauri::command]
pub fn filesystem_transfer_conflicts(sources: Vec<String>, destination_dir: String) -> Vec<String> {
  let destination_dir_path = PathBuf::from(destination_dir);
  sources
    .into_iter()
    .filter(|source| {
      let source_path = Path::new(source);
      let Some(name) = source_path.file_name() else {
        return false;
      };
      let destination_path = destination_dir_path.join(name);
      destination_path.exists()
        && fs::canonicalize(&destination_path).ok() != fs::canonicalize(source_path).ok()
    })
    .collect()
}

#[tauri::command]
pub fn filesystem_transfer_cancel(state: State<FilesystemTransferState>, job_id: String) {
  if let Some(cancelled) = state.cancel_flags.lock().ok().and_then(|flags| flags.get(&job_id).cloned()) {
    cancelled.store(true, Ordering::Relaxed);
  }
}

/// Returns where the item ended up, or null when it already was there.
#[tauri::command]
pub async fn move_path(
  window: tauri::Window,
  state: State<'_, FilesystemTransferState>,
  source: String,
  destination_dir: String,
  job_id: Option<String>,
  conflict_policy: Option<ConflictPolicy>,
) -> Result<Option<String>, String> {
  let mut progress = start_job_progress(window, &state, job_id, 1);
  let (result, progress) = tauri::async_runtime::spawn_blocking(move || {
    let result = move_item(
      Path::new(&source),
      Path::new(&destination_dir),
      conflict_policy.unwrap_or_default(),
      &mut progress,
    );
    progress.finish_item();
    (result, progress)
  })
  .await
  .map_err(|error| error.to_string())?;
  finish_job(&state, &progress);
  result.map(|destination| destination.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn import_paths(
  window: tauri::Window,
  state: State<'_, FilesystemTransferState>,
  paths: Vec<String>,
  destination_dir: String,
  job_id: Option<String>,
  conflict_policy: Option<ConflictPolicy>,
) -> Result<ImportPathsResult, String> {
  let mut progress = start_job_progress(window, &state, job_id, paths.len());
  let (result, progress) = tauri::async_runtime::spawn_blocking(move || {
    let result = import_paths_core(&paths, Path::new(&destination_dir), conflict_policy.unwrap_or_default(), &mut progress);
    (result, progress)
  })
  .await
  .map_err(|error| error.to_string())?;
  finish_job(&state, &progress);
  result
}

pub(super) fn import_paths_core(
  paths: &[String],
  destination_dir_path: &Path,
  policy: ConflictPolicy,
  progress: &mut TransferProgress,
) -> Result<ImportPathsResult, String> {
  if paths.is_empty() {
    return Err("No paths were provided for import.".to_string());
  }
  if !destination_dir_path.is_dir() {
    return Err("The destination must be an existing folder.".to_string());
  }
  progress.bytes_total = paths.iter().map(|path| measure_bytes(Path::new(path))).sum();
  progress.emit(true);

  let mut result = ImportPathsResult { copied_paths: Vec::new(), skipped_paths: Vec::new() };
  for source in paths {
    match copy_item(Path::new(source), destination_dir_path, policy, progress)? {
      Some(destination_path) => result.copied_paths.push(destination_path.to_string_lossy().to_string()),
      None => result.skipped_paths.push(source.clone()),
    }
    progress.finish_item();
  }
  Ok(result)
}

/// Sends the items to the Recycle Bin; runs off the main thread so big folders don't freeze the UI.
#[tauri::command]
pub async fn delete_paths(paths: Vec<String>) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || delete_paths_core(paths))
    .await
    .map_err(|error| error.to_string())?
}

pub(super) fn delete_paths_core(paths: Vec<String>) -> Result<(), String> {
  let normalized_paths: Vec<PathBuf> = paths
    .into_iter()
    .filter_map(|path| (!path.trim().is_empty()).then_some(PathBuf::from(path)))
    .collect();

  if normalized_paths.is_empty() {
    return Err("No paths were provided for deletion.".to_string());
  }

  for path in normalized_paths {
    if !path.exists() {
      return Err(format!("The path '{}' does not exist.", path.to_string_lossy()));
    }
    trash::delete(&path).map_err(|error| error.to_string())?;
  }

  Ok(())
}

#[cfg(test)]
mod tests;
