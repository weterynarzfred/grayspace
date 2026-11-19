use super::{create_folders, remove_empty_folders_core};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_test_root(prefix: &str) -> PathBuf {
  let unique_id = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("system time should be after unix epoch")
    .as_nanos();
  std::env::temp_dir().join(format!("{prefix}_{unique_id}"))
}

#[test]
fn undo_recreates_removed_folders_and_redo_removes_only_the_empty_ones() {
  let test_root = unique_test_root("grayspace_history_folders");
  let (photos, kept) = (test_root.join("photos"), test_root.join("kept"));
  let (trips, empty) = (photos.join("trips"), kept.join("empty"));
  fs::create_dir_all(&kept).expect("should create a folder");
  fs::write(kept.join("file.txt"), "kept").expect("should create a file");
  let folder = |path: &Path| path.to_string_lossy().to_string();

  create_folders(&[folder(&trips), folder(&photos)]).expect("should recreate folders");
  let recreated = trips.is_dir();
  fs::create_dir(&empty).expect("should create an empty folder");
  remove_empty_folders_core(&[folder(&trips), folder(&photos), folder(&empty), folder(&kept)]);
  let still_there = [&photos, &empty, &kept, &kept.join("file.txt")].map(|path| path.exists());
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert!(recreated, "the folders should be recreated");
  assert_eq!(still_there, [false, false, true, true], "only the empty folders should go");
}
