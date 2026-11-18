use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::{
  collect_cached_files, mark_used, prune_cached_files, prune_files, THUMBNAIL_CACHE_MAX_BYTES,
};

const HOUR: Duration = Duration::from_secs(60 * 60);
const DAY: Duration = Duration::from_secs(24 * 60 * 60);

fn unique_test_root(prefix: &str) -> PathBuf {
  let unique_id = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("system time should be after unix epoch")
    .as_nanos();
  std::env::temp_dir().join(format!("{prefix}_{unique_id}"))
}

fn backdate(path: &Path, age: Duration) {
  fs::OpenOptions::new()
    .write(true)
    .open(path)
    .and_then(|file| file.set_modified(SystemTime::now() - age))
    .expect("should backdate file");
}

fn write_cached_file(path: &Path, age: Duration) {
  fs::create_dir_all(path.parent().expect("cached file should have a parent"))
    .expect("should create cache directory");
  fs::write(path, b"webp").expect("should write cached file");
  backdate(path, age);
}

fn modified(path: &Path) -> SystemTime {
  fs::metadata(path)
    .and_then(|metadata| metadata.modified())
    .expect("should read modified time")
}

fn file_names(directory: &Path) -> Vec<String> {
  fs::read_dir(directory)
    .expect("directory should still exist")
    .map(|entry| entry.expect("should read entry").file_name().to_string_lossy().to_string())
    .collect()
}

#[test]
fn prune_removes_files_unused_for_max_age() {
  let root = unique_test_root("grayspace_thumbnail_cache_prune");
  let current_dir = root.join("v1").join("64").join("ab").join("cd");
  let old_schema_dir = root.join("v0").join("64").join("ab").join("cd");
  write_cached_file(&current_dir.join("old.webp"), 31 * DAY);
  write_cached_file(&current_dir.join("old.webp.123.tmp"), 31 * DAY);
  write_cached_file(&old_schema_dir.join("stale.webp"), 31 * DAY);
  write_cached_file(&current_dir.join("fresh.webp"), Duration::ZERO);

  let removed_files = prune_cached_files(&root).expect("prune should succeed");

  assert_eq!(removed_files, 3);
  assert_eq!(file_names(&current_dir), ["fresh.webp"]);
  assert!(file_names(&old_schema_dir).is_empty());

  fs::remove_dir_all(&root).expect("should clean up test root");
}

#[test]
fn prune_keeps_recently_used_file() {
  let root = unique_test_root("grayspace_thumbnail_cache_used");
  let path = root.join("v1").join("64").join("ab").join("cd").join("used.webp");
  write_cached_file(&path, 31 * DAY);

  mark_used(&path, &fs::metadata(&path).expect("should stat cached file"));
  let removed_files = prune_cached_files(&root).expect("prune should succeed");

  assert_eq!(removed_files, 0);
  assert!(path.is_file());

  fs::remove_dir_all(&root).expect("should clean up test root");
}

#[test]
fn prune_keeps_expired_file_used_after_walk() {
  let root = unique_test_root("grayspace_thumbnail_cache_used_after_walk");
  let path = root.join("v1").join("64").join("ab").join("cd").join("used.webp");
  write_cached_file(&path, 31 * DAY);

  let files = collect_cached_files(&root).expect("should collect cached files");
  mark_used(&path, &fs::metadata(&path).expect("should stat cached file"));
  let removed_files = prune_files(files, THUMBNAIL_CACHE_MAX_BYTES);

  assert_eq!(removed_files, 0);
  assert!(path.is_file());

  fs::remove_dir_all(&root).expect("should clean up test root");
}

#[test]
fn size_prune_skips_oldest_file_used_after_walk() {
  let root = unique_test_root("grayspace_thumbnail_cache_size_used_after_walk");
  let directory = root.join("v1").join("64").join("ab").join("cd");
  let used = directory.join("used.webp");
  write_cached_file(&used, 3 * DAY);
  write_cached_file(&directory.join("unused.webp"), 2 * DAY);

  let files = collect_cached_files(&root).expect("should collect cached files");
  mark_used(&used, &fs::metadata(&used).expect("should stat cached file"));
  // Room for one of the two 4-byte files.
  let removed_files = prune_files(files, 4);

  assert_eq!(removed_files, 1);
  assert_eq!(file_names(&directory), ["used.webp"]);

  fs::remove_dir_all(&root).expect("should clean up test root");
}

#[test]
fn mark_used_refreshes_stale_time() {
  let root = unique_test_root("grayspace_thumbnail_cache_stale");
  let path = root.join("stale.webp");
  write_cached_file(&path, 2 * DAY);

  mark_used(&path, &fs::metadata(&path).expect("should stat cached file"));

  let age = modified(&path).elapsed().unwrap_or_default();
  assert!(age < Duration::from_secs(60), "mtime should be refreshed, age was {age:?}");

  fs::remove_dir_all(&root).expect("should clean up test root");
}

#[test]
fn mark_used_leaves_recent_time() {
  let root = unique_test_root("grayspace_thumbnail_cache_recent");
  let path = root.join("recent.webp");
  write_cached_file(&path, HOUR);
  let before = modified(&path);

  mark_used(&path, &fs::metadata(&path).expect("should stat cached file"));

  assert_eq!(modified(&path), before);

  fs::remove_dir_all(&root).expect("should clean up test root");
}
