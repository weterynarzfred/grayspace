use super::listing::{read_fs_entry, FsEntry};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::mem;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, State};

const FILESYSTEM_SEARCH_EVENT: &str = "filesystem-search-results";
const MAX_SEARCH_RESULTS: usize = 5000;
const RESULT_BATCH_INTERVAL: Duration = Duration::from_millis(100);

struct RunningSearch {
  window_label: String,
  cancelled: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct FilesystemSearchState {
  searches: Mutex<HashMap<String, RunningSearch>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilesystemSearchPayload {
  search_id: String,
  entries: Vec<FsEntry>,
  done: bool,
  truncated: bool,
}

/// Breadth-first, so shallow matches arrive first. Symlinks and junctions are not followed
/// (they can loop), unreadable folders are skipped. `on_match` returns false to stop early.
pub(super) fn walk_matching_entries(
  root: &Path,
  query: &str,
  cancelled: &AtomicBool,
  mut on_match: impl FnMut(FsEntry) -> bool,
) {
  let needle = query.trim().to_lowercase();
  let mut pending_dirs = VecDeque::from([root.to_path_buf()]);

  while let Some(dir_path) = pending_dirs.pop_front() {
    if cancelled.load(Ordering::Relaxed) {
      return;
    }
    let Ok(read_dir) = fs::read_dir(&dir_path) else {
      continue;
    };
    for dir_entry in read_dir.flatten() {
      let Ok(entry) = read_fs_entry(&dir_entry) else {
        continue;
      };
      let is_symlink = dir_entry.file_type().is_ok_and(|file_type| file_type.is_symlink());
      if entry.is_dir && !is_symlink {
        pending_dirs.push_back(dir_entry.path());
      }
      if entry.name.to_lowercase().contains(&needle) && !on_match(entry) {
        return;
      }
    }
  }
}

fn stop_searches(state: &FilesystemSearchState, should_cancel: impl Fn(&str, &RunningSearch) -> bool) {
  let Ok(mut searches) = state.searches.lock() else {
    return;
  };
  searches.retain(|search_id, search| {
    let cancel = should_cancel(search_id, search);
    if cancel {
      search.cancelled.store(true, Ordering::Relaxed);
    }
    !cancel
  });
}

/// Streams matches as `filesystem-search-results` events to the calling window, in batches,
/// ending with `done: true` unless the search was cancelled.
#[tauri::command]
pub fn filesystem_search_start(
  window: tauri::Window,
  state: State<FilesystemSearchState>,
  search_id: String,
  root: String,
  query: String,
) -> Result<(), String> {
  if query.trim().is_empty() {
    return Err("A search query is required.".to_string());
  }
  let root_path = PathBuf::from(root.trim());
  if !root_path.is_dir() {
    return Err("The search root must be an existing folder.".to_string());
  }

  let cancelled = Arc::new(AtomicBool::new(false));
  state
    .searches
    .lock()
    .map_err(|_| "Failed to access running searches.".to_string())?
    .insert(search_id.clone(), RunningSearch {
      window_label: window.label().to_string(),
      cancelled: cancelled.clone(),
    });

  thread::spawn(move || {
    let emit = |entries: Vec<FsEntry>, done: bool, truncated: bool| {
      let _ = window.emit(FILESYSTEM_SEARCH_EVENT, FilesystemSearchPayload {
        search_id: search_id.clone(),
        entries,
        done,
        truncated,
      });
    };
    let mut batch = Vec::new();
    let mut match_count = 0;
    let mut last_emit = Instant::now();

    walk_matching_entries(&root_path, &query, &cancelled, |entry| {
      batch.push(entry);
      match_count += 1;
      if last_emit.elapsed() >= RESULT_BATCH_INTERVAL {
        emit(mem::take(&mut batch), false, false);
        last_emit = Instant::now();
      }
      match_count < MAX_SEARCH_RESULTS
    });

    if !cancelled.load(Ordering::Relaxed) {
      emit(batch, true, match_count >= MAX_SEARCH_RESULTS);
    }
    let search_state = window.app_handle().state::<FilesystemSearchState>();
    stop_searches(&search_state, |running_id, _| *running_id == search_id);
  });

  Ok(())
}

#[tauri::command]
pub fn filesystem_search_cancel(state: State<FilesystemSearchState>, search_id: String) {
  stop_searches(&state, |running_id, _| *running_id == search_id);
}

/// Lets search results drop entries that were deleted or moved away since the search ran.
#[tauri::command]
pub fn filesystem_existing_paths(paths: Vec<String>) -> Vec<String> {
  paths.into_iter().filter(|path| Path::new(path).exists()).collect()
}

pub fn handle_search_window_destroyed(state: &FilesystemSearchState, window_label: &str) {
  stop_searches(state, |_, search| search.window_label == window_label);
}

#[cfg(test)]
mod tests;
