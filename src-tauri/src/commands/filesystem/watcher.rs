use notify::{EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

type FilesystemWatcher = notify::RecommendedWatcher;

pub(super) struct ManagedFilesystemWatcher {
  pub(super) _watcher: FilesystemWatcher,
  pub(super) canonical_path: PathBuf,
  pub(super) window_label: String,
  pub(super) watch_id: String,
}

const FILESYSTEM_WATCH_EVENT: &str = "filesystem-watch-event";

#[derive(Default)]
pub struct FilesystemWatchState {
  watchers: Mutex<HashMap<String, ManagedFilesystemWatcher>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilesystemWatchEventPayload {
  watch_id: String,
  changed_path: String,
}

pub(super) fn watch_state_key(window_label: &str, watch_id: &str) -> String {
  format!("{window_label}::{watch_id}")
}

fn is_watch_event_relevant(kind: &EventKind) -> bool {
  matches!(
    kind,
    EventKind::Any | EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
  )
}

pub(super) fn create_filesystem_watcher<F>(event_handler: F) -> Result<FilesystemWatcher, String>
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

fn is_same_or_descendant_path(path: &Path, root: &Path) -> bool {
  path == root || path.starts_with(root)
}

pub(super) fn remap_path_prefix(path: &Path, source: &Path, destination: &Path) -> PathBuf {
  if path == source {
    return destination.to_path_buf();
  }

  match path.strip_prefix(source) {
    Ok(suffix) => destination.join(suffix),
    Err(_) => path.to_path_buf(),
  }
}

pub(super) fn drain_watchers_in_path_tree(
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

pub(super) fn suspend_watchers_for_path(
  state: &State<FilesystemWatchState>,
  source_canonical_path: &Path,
) -> Result<Vec<ManagedFilesystemWatcher>, String> {
  let mut watchers = state
    .watchers
    .lock()
    .map_err(|_| "Failed to access filesystem watcher state.".to_string())?;
  Ok(drain_watchers_in_path_tree(&mut watchers, source_canonical_path))
}

pub(super) fn restore_suspended_watchers(
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
