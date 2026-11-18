use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

use super::types::ThumbnailClearResult;
use super::{system_time_to_unix_secs, thumbnails_dir};

const THUMBNAIL_CACHE_MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
// Counted from last use, not creation: mark_used moves the mtime forward on cache hits.
const THUMBNAIL_CACHE_MAX_AGE_SECS: u64 = 30 * 24 * 60 * 60;
// Keeps the walk's disk IO away from the first folder listing and thumbnail round.
const PRUNE_START_DELAY: Duration = Duration::from_secs(30);
const PRUNE_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
// Hits run on the main thread; a daily limit keeps the common hit to a single stat.
const LAST_USED_REFRESH: Duration = Duration::from_secs(24 * 60 * 60);

struct CachedFile {
  path: PathBuf,
  size: u64,
  modified_secs: Option<u64>,
}

// Takes no locks: files being written have a fresh mtime and prune never removes
// directories, so in-flight jobs can't lose their temp file or parent directory.
pub fn start_thumbnail_cache_pruning(app: AppHandle) {
  thread::spawn(move || {
    thread::sleep(PRUNE_START_DELAY);
    loop {
      if let Err(error) = thumbnails_dir(&app).and_then(|dir| prune_cached_files(&dir)) {
        eprintln!("[thumbnail-cache] Pruning failed: {error}");
      }
      thread::sleep(PRUNE_INTERVAL);
    }
  });
}

pub(super) fn mark_used(path: &Path, metadata: &fs::Metadata) {
  let is_stale = metadata
    .modified()
    .ok()
    .and_then(|modified| modified.elapsed().ok())
    .is_some_and(|age| age > LAST_USED_REFRESH);
  if is_stale {
    let _ = fs::OpenOptions::new()
      .write(true)
      .open(path)
      .and_then(|file| file.set_modified(SystemTime::now()));
  }
}

fn collect_cached_files(root: &Path) -> Result<Vec<CachedFile>, String> {
  if !root.exists() {
    return Ok(Vec::new());
  }

  let mut stack = vec![root.to_path_buf()];
  let mut files = Vec::new();

  while let Some(directory) = stack.pop() {
    let read_dir = fs::read_dir(&directory).map_err(|error| error.to_string())?;
    for entry in read_dir {
      let dir_entry = entry.map_err(|error| error.to_string())?;
      let path = dir_entry.path();
      let file_type = dir_entry.file_type().map_err(|error| error.to_string())?;
      if file_type.is_dir() {
        stack.push(path);
        continue;
      }

      if !file_type.is_file() {
        continue;
      }

      let metadata = dir_entry.metadata().map_err(|error| error.to_string())?;
      files.push(CachedFile {
        path,
        size: metadata.len(),
        modified_secs: system_time_to_unix_secs(metadata.modified()),
      });
    }
  }

  Ok(files)
}

// Returns how many files were removed.
fn prune_cached_files(root: &Path) -> Result<usize, String> {
  Ok(prune_files(collect_cached_files(root)?, THUMBNAIL_CACHE_MAX_BYTES))
}

fn prune_files(mut files: Vec<CachedFile>, max_bytes: u64) -> usize {
  let now_secs = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .ok()
    .map(|duration| duration.as_secs())
    .unwrap_or(0);
  let mut removed_files = 0usize;

  files.retain(|file| {
    let is_expired = file
      .modified_secs
      .map(|modified| now_secs.saturating_sub(modified) > THUMBNAIL_CACHE_MAX_AGE_SECS)
      .unwrap_or(false);
    if !is_expired {
      return true;
    }

    if remove_if_unchanged(file) {
      removed_files += 1;
      return false;
    }

    true
  });

  let mut total_bytes = files.iter().map(|file| file.size).sum::<u64>();
  if total_bytes > max_bytes {
    files.sort_by_key(|file| file.modified_secs.unwrap_or(0));
    for file in files {
      if total_bytes <= max_bytes {
        break;
      }

      if !remove_if_unchanged(&file) {
        continue;
      }

      removed_files += 1;
      total_bytes = total_bytes.saturating_sub(file.size);
    }
  }

  removed_files
}

// The walk takes seconds on a large cache. A file that mark_used refreshed since then
// has a newer mtime than the walk saw, so it stays.
fn remove_if_unchanged(file: &CachedFile) -> bool {
  let modified_secs =
    system_time_to_unix_secs(fs::metadata(&file.path).and_then(|metadata| metadata.modified()));
  modified_secs == file.modified_secs && fs::remove_file(&file.path).is_ok()
}

pub(super) fn clear_cached_files(root: &Path) -> Result<ThumbnailClearResult, String> {
  let files = collect_cached_files(root)?;
  let removed_files = files.len();
  let removed_bytes = files.iter().map(|file| file.size).sum::<u64>();

  if root.exists() {
    fs::remove_dir_all(root).map_err(|error| error.to_string())?;
  }
  fs::create_dir_all(root).map_err(|error| error.to_string())?;

  Ok(ThumbnailClearResult {
    removed_files,
    removed_bytes,
  })
}

#[cfg(test)]
mod tests;
