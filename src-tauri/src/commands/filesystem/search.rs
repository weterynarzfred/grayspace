use super::listing::{read_fs_entry, FsEntry};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
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

/// Sent by the frontend, which owns the defaults. `skip_folder_names` is already empty when
/// skipping is switched off. `skip_hidden` follows the app's hidden-files preference.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
  use_regex: bool,
  skip_folder_names: Vec<String>,
  skip_cache_dir_tagged: bool,
  skip_hidden: bool,
}

enum EntryMatcher {
  NameContains(String),
  RelativePathRegex(Regex),
}

/// What a search matches and which folders it does not descend into. Built before the walk
/// starts, so an invalid regex is returned by the command instead of ending the search silently.
pub(super) struct SearchCriteria {
  matcher: EntryMatcher,
  skipped_folder_names: HashSet<String>,
  skip_cache_dir_tagged: bool,
  skip_hidden: bool,
}

impl SearchCriteria {
  fn new(query: &str, options: SearchOptions) -> Result<Self, String> {
    let query = query.trim();
    let matcher = if options.use_regex {
      let regex = RegexBuilder::new(query)
        .case_insensitive(true)
        .build()
        .map_err(|error| {
          // Parse errors span several lines (pattern, caret, reason); the last one is the reason.
          let message = error.to_string();
          let reason = message.lines().last().unwrap_or_default();
          format!("Invalid regex: {}", reason.trim_start_matches("error: "))
        })?;
      EntryMatcher::RelativePathRegex(regex)
    } else {
      EntryMatcher::NameContains(query.to_lowercase())
    };

    Ok(Self {
      matcher,
      skipped_folder_names: options
        .skip_folder_names
        .iter()
        .map(|name| name.to_lowercase())
        .collect(),
      skip_cache_dir_tagged: options.skip_cache_dir_tagged,
      skip_hidden: options.skip_hidden,
    })
  }

  fn matches(&self, name: &str, relative_path: &str) -> bool {
    match &self.matcher {
      EntryMatcher::NameContains(needle) => name.to_lowercase().contains(needle),
      EntryMatcher::RelativePathRegex(regex) => regex.is_match(relative_path),
    }
  }

  fn should_descend(&self, name: &str, path: &Path) -> bool {
    !self.skipped_folder_names.contains(&name.to_lowercase())
      && !(self.skip_cache_dir_tagged && path.join("CACHEDIR.TAG").is_file())
  }
}

/// Breadth-first, so shallow matches arrive first. Symlinks and junctions are not followed
/// (they can loop), unreadable folders are skipped. Skipped folders are still matched by name,
/// just not descended into; skipped hidden entries are neither matched nor descended into. The
/// root itself is always searched. Regexes see the path relative to the root with "/" between
/// folders. `on_match` returns false to stop early.
pub(super) fn walk_matching_entries(
  root: &Path,
  criteria: &SearchCriteria,
  cancelled: &AtomicBool,
  mut on_match: impl FnMut(FsEntry) -> bool,
) {
  let mut pending_dirs = VecDeque::from([(root.to_path_buf(), String::new())]);

  while let Some((dir_path, dir_relative_path)) = pending_dirs.pop_front() {
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
      if criteria.skip_hidden && entry.is_hidden {
        continue;
      }
      let relative_path = if dir_relative_path.is_empty() {
        entry.name.clone()
      } else {
        format!("{dir_relative_path}/{}", entry.name)
      };
      let is_symlink = dir_entry.file_type().is_ok_and(|file_type| file_type.is_symlink());
      let descend = entry.is_dir && !is_symlink && criteria.should_descend(&entry.name, &dir_entry.path());
      if criteria.matches(&entry.name, &relative_path) && !on_match(entry) {
        return;
      }
      if descend {
        pending_dirs.push_back((dir_entry.path(), relative_path));
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
  options: SearchOptions,
) -> Result<(), String> {
  if query.trim().is_empty() {
    return Err("A search query is required.".to_string());
  }
  let root_path = PathBuf::from(root.trim());
  if !root_path.is_dir() {
    return Err("The search root must be an existing folder.".to_string());
  }
  let criteria = SearchCriteria::new(&query, options)?;

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

    walk_matching_entries(&root_path, &criteria, &cancelled, |entry| {
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
