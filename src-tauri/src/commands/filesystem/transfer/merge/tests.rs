use super::super::{
  copy_across_devices, copy_item, filesystem_transfer_conflicts, move_item, move_whole, ConflictPolicy,
  MovePathResult, TransferProgress, TRANSFER_CANCELLED_ERROR,
};
#[cfg(target_os = "windows")]
use super::super::{rename_or_copy, MoveStep};
use super::{merge_move, MergeRecord};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_test_root(prefix: &str) -> PathBuf {
  let unique_id = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("system time should be after unix epoch")
    .as_nanos();
  std::env::temp_dir().join(format!("{prefix}_{unique_id}"))
}

/// `relative` uses "/" between folders.
fn under(root: &Path, relative: &str) -> PathBuf {
  relative.split('/').fold(root.to_path_buf(), |path, part| path.join(part))
}

fn path_string(path: PathBuf) -> String {
  path.to_string_lossy().to_string()
}

fn create_files(root: &Path, files: &[(&str, &str)]) {
  for (relative_path, contents) in files {
    let path = under(root, relative_path);
    fs::create_dir_all(path.parent().expect("file should have a parent")).expect("should create folders");
    fs::write(&path, contents).expect("should create file");
  }
}

/// Everything under `root`, sorted: "folder/" for a folder, "file=contents" for a file.
fn tree(root: &Path) -> Vec<String> {
  let mut entries = Vec::new();
  let mut pending_dirs = vec![root.to_path_buf()];
  while let Some(dir) = pending_dirs.pop() {
    for entry in fs::read_dir(&dir).expect("should read folder") {
      let path = entry.expect("should read entry").path();
      let relative_path = path
        .strip_prefix(root)
        .expect("entry should be under root")
        .to_string_lossy()
        .replace('\\', "/");
      if path.is_dir() {
        entries.push(format!("{relative_path}/"));
        pending_dirs.push(path);
      } else {
        entries.push(format!("{relative_path}={}", fs::read_to_string(&path).expect("should read file")));
      }
    }
  }
  entries.sort();
  entries
}

fn copy_replacing(source_path: &Path, destination_dir: &Path) -> Option<PathBuf> {
  copy_replacing_or_error(source_path, destination_dir).expect("merging copy should succeed")
}

fn move_replacing(source_path: &Path, destination_dir: &Path) -> MovePathResult {
  move_replacing_or_error(source_path, destination_dir).expect("merging move should succeed")
}

fn copy_replacing_or_error(source_path: &Path, destination_dir: &Path) -> Result<Option<PathBuf>, String> {
  copy_item(source_path, destination_dir, ConflictPolicy::Replace, &mut TransferProgress::silent())
}

fn move_replacing_or_error(source_path: &Path, destination_dir: &Path) -> Result<MovePathResult, String> {
  move_item(source_path, destination_dir, None, ConflictPolicy::Replace, &mut TransferProgress::silent())
}

fn moved_pairs(record: &MergeRecord) -> Vec<(String, String)> {
  let mut pairs: Vec<_> = record
    .moved_items
    .iter()
    .map(|item| (item.source_path.clone(), item.destination_path.clone()))
    .collect();
  pairs.sort();
  pairs
}

/// Opens the file without sharing, so nothing can read, move or recycle it until the handle drops.
#[cfg(target_os = "windows")]
fn lock_file(path: &Path) -> fs::File {
  use std::os::windows::fs::OpenOptionsExt;
  fs::OpenOptions::new().read(true).share_mode(0).open(path).expect("should lock the file")
}

#[test]
fn copy_merges_folders_replacing_same_named_files_and_keeping_the_rest() {
  let test_root = unique_test_root("grayspace_merge_copy");
  let (source_dir, destination_dir) = (test_root.join("source"), test_root.join("destination"));
  create_files(&source_dir, &[
    ("photos/new.txt", "new"),
    ("photos/same.txt", "new same"),
    ("photos/nested/deep_new.txt", "deep new"),
    ("photos/nested/deep_same.txt", "new deep same"),
    ("photos/only_in_source/inner.txt", "inner"),
  ]);
  create_files(&destination_dir, &[
    ("photos/keep.txt", "keep"),
    ("photos/same.txt", "old same"),
    ("photos/nested/deep_keep.txt", "deep keep"),
    ("photos/nested/deep_same.txt", "old deep same"),
  ]);

  let copied = copy_replacing(&source_dir.join("photos"), &destination_dir);
  let destination_tree = tree(&destination_dir.join("photos"));
  let source_tree = tree(&source_dir.join("photos"));
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert_eq!(copied, Some(destination_dir.join("photos")));
  assert_eq!(destination_tree, [
    "keep.txt=keep",
    "nested/",
    "nested/deep_keep.txt=deep keep",
    "nested/deep_new.txt=deep new",
    "nested/deep_same.txt=new deep same",
    "new.txt=new",
    "only_in_source/",
    "only_in_source/inner.txt=inner",
    "same.txt=new same",
  ]);
  assert_eq!(source_tree, [
    "nested/",
    "nested/deep_new.txt=deep new",
    "nested/deep_same.txt=new deep same",
    "new.txt=new",
    "only_in_source/",
    "only_in_source/inner.txt=inner",
    "same.txt=new same",
  ]);
}

#[test]
fn move_merges_folders_and_removes_the_source_folders_it_empties() {
  let test_root = unique_test_root("grayspace_merge_move");
  let (source_dir, destination_dir) = (test_root.join("source"), test_root.join("destination"));
  create_files(&source_dir, &[
    ("photos/new.txt", "new"),
    ("photos/same.txt", "new same"),
    ("photos/nested/deep_new.txt", "deep new"),
    ("photos/whole/inner.txt", "inner"),
  ]);
  create_files(&destination_dir, &[
    ("photos/keep.txt", "keep"),
    ("photos/same.txt", "old same"),
    ("photos/nested/deep_keep.txt", "deep keep"),
  ]);

  let moved = move_replacing(&source_dir.join("photos"), &destination_dir);
  let destination_tree = tree(&destination_dir.join("photos"));
  let source_tree = tree(&source_dir);
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert_eq!(moved.destination, Some(path_string(destination_dir.join("photos"))));
  assert_eq!(destination_tree, [
    "keep.txt=keep",
    "nested/",
    "nested/deep_keep.txt=deep keep",
    "nested/deep_new.txt=deep new",
    "new.txt=new",
    "same.txt=new same",
    "whole/",
    "whole/inner.txt=inner",
  ]);
  assert!(source_tree.is_empty(), "the emptied source folders should be gone: {source_tree:?}");
  let record = moved.merge.expect("the move should report its merge");
  let pair = |relative: &str| {
    (path_string(under(&source_dir, relative)), path_string(under(&destination_dir, relative)))
  };
  // "whole" has no counterpart, so it moved as one item.
  assert_eq!(moved_pairs(&record), [
    pair("photos/nested/deep_new.txt"),
    pair("photos/new.txt"),
    pair("photos/same.txt"),
    pair("photos/whole"),
  ]);
  assert_eq!(record.removed_folders, [
    path_string(under(&source_dir, "photos/nested")),
    path_string(under(&source_dir, "photos")),
  ]);
}

#[cfg(target_os = "windows")]
#[test]
fn move_merge_stops_at_a_child_that_fails_and_keeps_both_its_versions() {
  let test_root = unique_test_root("grayspace_merge_move_failure");
  let (source_dir, destination_dir) = (test_root.join("source"), test_root.join("destination"));
  create_files(&source_dir, &[
    ("photos/a_nested/deep.txt", "deep"),
    ("photos/b_free.txt", "free"),
    ("photos/c_locked.txt", "locked"),
    ("photos/d_later.txt", "later"),
  ]);
  create_files(&destination_dir, &[
    ("photos/keep.txt", "keep"),
    ("photos/a_nested/deep_keep.txt", "deep keep"),
    ("photos/c_locked.txt", "old"),
  ]);
  let locked_path = under(&source_dir, "photos/c_locked.txt");
  let lock = lock_file(&locked_path);

  let moved = move_replacing_or_error(&source_dir.join("photos"), &destination_dir)
    .expect("a merge that stops at an error should still report what it moved");
  drop(lock);
  let source_tree = tree(&source_dir.join("photos"));
  let destination_tree = tree(&destination_dir.join("photos"));
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  let error = moved.error.expect("the move should report why the merge stopped");
  assert!(error.contains(&path_string(locked_path)), "the error should name the item: {error}");
  // NTFS lists names in order: a_nested and b_free.txt moved before c_locked.txt failed.
  assert_eq!(source_tree, ["c_locked.txt=locked", "d_later.txt=later"]);
  assert_eq!(destination_tree, [
    "a_nested/",
    "a_nested/deep.txt=deep",
    "a_nested/deep_keep.txt=deep keep",
    "b_free.txt=free",
    "c_locked.txt=old",
    "keep.txt=keep",
  ]);
  let pair = |relative: &str| {
    (path_string(under(&source_dir, relative)), path_string(under(&destination_dir, relative)))
  };
  let record = moved.merge.expect("the move should report its merge");
  assert_eq!(moved_pairs(&record), [pair("photos/a_nested/deep.txt"), pair("photos/b_free.txt")]);
  assert_eq!(record.removed_folders, [path_string(under(&source_dir, "photos/a_nested"))]);
}

#[cfg(target_os = "windows")]
#[test]
fn copy_merge_stops_at_a_child_that_fails_and_keeps_the_item_it_would_replace() {
  let test_root = unique_test_root("grayspace_merge_copy_failure");
  let (source_dir, destination_dir) = (test_root.join("source"), test_root.join("destination"));
  create_files(&source_dir, &[("photos/a_new.txt", "new"), ("photos/db.bin", "new db")]);
  create_files(&destination_dir, &[("photos/db.bin", "old db"), ("photos/keep.txt", "keep")]);
  let locked_path = under(&source_dir, "photos/db.bin");
  let lock = lock_file(&locked_path);

  let copied = copy_replacing_or_error(&source_dir.join("photos"), &destination_dir);
  drop(lock);
  let destination_tree = tree(&destination_dir.join("photos"));
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  let error = copied.expect_err("copying a locked file should fail");
  assert!(error.contains(&path_string(locked_path)), "the error should name the item: {error}");
  assert_eq!(destination_tree, ["a_new.txt=new", "db.bin=old db", "keep.txt=keep"]);
}

#[cfg(target_os = "windows")]
#[test]
fn an_item_that_cannot_go_to_the_recycle_bin_keeps_its_place_and_its_replacement_goes_back() {
  let test_root = unique_test_root("grayspace_merge_locked_old_item");
  let (source_dir, destination_dir) = (test_root.join("source"), test_root.join("destination"));
  create_files(&source_dir, &[("photos/report.txt", "new")]);
  create_files(&destination_dir, &[("photos/report.txt", "old")]);
  let lock = lock_file(&under(&destination_dir, "photos/report.txt"));

  let copied = copy_replacing_or_error(&source_dir.join("photos"), &destination_dir);
  let moved = move_replacing_or_error(&source_dir.join("photos"), &destination_dir);
  drop(lock);
  let source_tree = tree(&source_dir);
  let destination_tree = tree(&destination_dir);
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert!(copied.is_err());
  assert!(moved.is_ok_and(|moved| moved.error.is_some()));
  assert_eq!(source_tree, ["photos/", "photos/report.txt=new"]);
  assert_eq!(destination_tree, ["photos/", "photos/report.txt=old"]);
}

#[cfg(target_os = "windows")]
thread_local! {
  /// What a locking move step staged, locked until the test takes it.
  static STAGED_LOCK: std::cell::RefCell<Option<fs::File>> = const { std::cell::RefCell::new(None) };
}

/// A move on one drive that also locks the item it renamed, so that renaming it back fails.
#[cfg(target_os = "windows")]
fn rename_and_lock(source_path: &Path, destination_path: &Path, progress: &mut TransferProgress) -> Result<bool, String> {
  let copied = rename_or_copy(source_path, destination_path, progress)?;
  STAGED_LOCK.set(Some(lock_file(destination_path)));
  Ok(copied)
}

/// A move across drives that also locks the copy it made, so that removing it fails.
#[cfg(target_os = "windows")]
fn copy_and_lock(source_path: &Path, destination_path: &Path, progress: &mut TransferProgress) -> Result<bool, String> {
  let copied = copy_across_devices(source_path, destination_path, progress)?;
  STAGED_LOCK.set(Some(lock_file(destination_path)));
  Ok(copied)
}

#[cfg(target_os = "windows")]
#[test]
fn the_error_tells_where_a_replacement_stays_when_it_cannot_be_taken_back() {
  for (move_step, source_left) in [(rename_and_lock as MoveStep, vec![]), (copy_and_lock, vec!["report.txt=new"])] {
    let test_root = unique_test_root("grayspace_merge_stuck_replacement");
    let (source_dir, destination_dir) = (test_root.join("source"), test_root.join("destination"));
    create_files(&source_dir, &[("photos/report.txt", "new")]);
    create_files(&destination_dir, &[("photos/report.txt", "old")]);
    // The old item cannot go to the Recycle Bin, and the step locks what it staged.
    let lock = lock_file(&under(&destination_dir, "photos/report.txt"));

    let merged = merge_move(
      &source_dir.join("photos"),
      &destination_dir.join("photos"),
      move_step,
      &mut TransferProgress::silent(),
      &mut MergeRecord::default(),
    );
    drop(STAGED_LOCK.take());
    drop(lock);
    let source_tree = tree(&source_dir.join("photos"));
    let destination_tree = tree(&destination_dir.join("photos"));
    fs::remove_dir_all(&test_root).expect("should clean up temp root");

    let error = merged.expect_err("the old item should stay");
    // The staging number is shared by every transfer, so it depends on what ran before.
    let [staged_entry, old_entry] = destination_tree.as_slice() else {
      panic!("expected the staged and the old item: {destination_tree:?}");
    };
    let staged_name = staged_entry.strip_suffix("=new").expect("the staged item should be the new one");
    assert!(staged_name.starts_with(".grayspace-"), "unexpected staged name: {staged_name}");
    assert_eq!(old_entry, "report.txt=old");
    let staged = path_string(under(&destination_dir, &format!("photos/{staged_name}")));
    assert!(error.contains(&staged), "the error should name the staged item: {error}");
    assert_eq!(source_tree, source_left);
  }
}

#[test]
fn replace_works_for_a_name_as_long_as_a_name_can_be() {
  let test_root = unique_test_root("grayspace_merge_long_name");
  let (source_dir, destination_dir) = (test_root.join("source"), test_root.join("destination"));
  // 248 characters: a staging name built from it would pass the limit of 255. (At 255 the Recycle
  // Bin call itself refuses the name, and the whole path needs the shell's long-path support.)
  let long_name = format!("{}.txt", "n".repeat(244));
  create_files(&source_dir, &[(&long_name, "new"), (&format!("photos/{long_name}"), "new in photos")]);
  create_files(&destination_dir, &[(&long_name, "old"), (&format!("photos/{long_name}"), "old in photos")]);
  let (source_file, destination_file) = (source_dir.join(&long_name), destination_dir.join(&long_name));

  let copied = copy_replacing_or_error(&source_file, &destination_dir).map(|_| ());
  let copied_contents = fs::read_to_string(&destination_file).expect("the copy should exist");
  fs::write(&destination_file, "old").expect("should put the old file back");
  let moved = move_replacing_or_error(&source_file, &destination_dir).map(|moved| moved.error);
  let merged = move_replacing_or_error(&source_dir.join("photos"), &destination_dir).map(|moved| moved.error);
  let source_tree = tree(&source_dir);
  let destination_tree = tree(&destination_dir);
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert_eq!(copied, Ok(()));
  assert_eq!(copied_contents, "new");
  assert_eq!(moved, Ok(None));
  assert_eq!(merged, Ok(None));
  assert!(source_tree.is_empty(), "everything should have moved: {source_tree:?}");
  assert_eq!(destination_tree, [
    format!("{long_name}=new"),
    "photos/".to_string(),
    format!("photos/{long_name}=new in photos"),
  ]);
}

/// The copy-and-delete path that moves across drives, with the user cancelling once an item moved.
fn copy_across_devices_then_cancel(
  source_path: &Path,
  destination_path: &Path,
  progress: &mut TransferProgress,
) -> Result<bool, String> {
  let copied = copy_across_devices(source_path, destination_path, progress)?;
  progress.cancelled.store(true, Ordering::Relaxed);
  Ok(copied)
}

#[test]
fn cancel_between_children_stops_a_merge_across_drives() {
  let test_root = unique_test_root("grayspace_merge_cancel");
  let (source_dir, destination_dir) = (test_root.join("source"), test_root.join("destination"));
  create_files(&source_dir, &[
    ("photos/a_nested/deep_new.txt", "deep new"),
    ("photos/b_new.txt", "new"),
    ("photos/c_same.txt", "new same"),
    ("photos/d_nested/new.txt", "new"),
  ]);
  create_files(&destination_dir, &[
    ("photos/keep.txt", "keep"),
    ("photos/a_nested/deep_keep.txt", "deep keep"),
    ("photos/c_same.txt", "old same"),
    ("photos/d_nested/keep.txt", "keep"),
  ]);

  let mut record = MergeRecord::default();
  let merged = merge_move(
    &source_dir.join("photos"),
    &destination_dir.join("photos"),
    copy_across_devices_then_cancel,
    &mut TransferProgress::silent(),
    &mut record,
  );
  let source_tree = tree(&source_dir.join("photos"));
  let destination_tree = tree(&destination_dir.join("photos"));
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  // The cancel came inside a_nested, right after deep_new.txt moved.
  assert_eq!(merged, Err(TRANSFER_CANCELLED_ERROR.to_string()));
  assert_eq!(destination_tree, [
    "a_nested/",
    "a_nested/deep_keep.txt=deep keep",
    "a_nested/deep_new.txt=deep new",
    "c_same.txt=old same",
    "d_nested/",
    "d_nested/keep.txt=keep",
    "keep.txt=keep",
  ]);
  assert_eq!(source_tree, ["b_new.txt=new", "c_same.txt=new same", "d_nested/", "d_nested/new.txt=new"]);
  let pair = |relative: &str| {
    (path_string(under(&source_dir, relative)), path_string(under(&destination_dir, relative)))
  };
  assert_eq!(moved_pairs(&record), [pair("photos/a_nested/deep_new.txt")]);
  assert_eq!(record.removed_folders, [path_string(under(&source_dir, "photos/a_nested"))]);
}

/// The copy-and-delete path that moves across drives, with the user cancelling as c_same.txt, the
/// child that replaces an existing item, starts to copy.
fn copy_across_devices_cancelling_at_c_same(
  source_path: &Path,
  destination_path: &Path,
  progress: &mut TransferProgress,
) -> Result<bool, String> {
  if source_path.ends_with("c_same.txt") {
    progress.cancelled.store(true, Ordering::Relaxed);
  }
  copy_across_devices(source_path, destination_path, progress)
}

#[test]
fn cancel_while_a_child_replaces_an_item_across_drives_keeps_the_old_item() {
  let test_root = unique_test_root("grayspace_merge_cancel_replacing");
  let (source_dir, destination_dir) = (test_root.join("source"), test_root.join("destination"));
  create_files(&source_dir, &[
    ("photos/b_new.txt", "new"),
    ("photos/c_same.txt", "new same"),
    ("photos/d_later.txt", "later"),
  ]);
  create_files(&destination_dir, &[("photos/c_same.txt", "old same"), ("photos/keep.txt", "keep")]);

  let mut record = MergeRecord::default();
  let merged = merge_move(
    &source_dir.join("photos"),
    &destination_dir.join("photos"),
    copy_across_devices_cancelling_at_c_same,
    &mut TransferProgress::silent(),
    &mut record,
  );
  let source_tree = tree(&source_dir.join("photos"));
  let destination_tree = tree(&destination_dir.join("photos"));
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert_eq!(merged, Err(TRANSFER_CANCELLED_ERROR.to_string()));
  assert_eq!(destination_tree, ["b_new.txt=new", "c_same.txt=old same", "keep.txt=keep"]);
  assert_eq!(source_tree, ["c_same.txt=new same", "d_later.txt=later"]);
  let moved_b_new = (
    path_string(under(&source_dir, "photos/b_new.txt")),
    path_string(under(&destination_dir, "photos/b_new.txt")),
  );
  assert_eq!(moved_pairs(&record), [moved_b_new]);
}

#[test]
fn move_item_reports_what_a_cancelled_merge_moved() {
  let test_root = unique_test_root("grayspace_merge_cancel_result");
  let (source_dir, destination_dir) = (test_root.join("source"), test_root.join("destination"));
  create_files(&source_dir, &[("photos/new.txt", "new")]);
  create_files(&destination_dir, &[("photos/keep.txt", "keep")]);
  let mut progress = TransferProgress::silent();
  progress.cancelled.store(true, Ordering::Relaxed);

  let moved = move_item(&source_dir.join("photos"), &destination_dir, None, ConflictPolicy::Replace, &mut progress)
    .expect("a cancelled merge should still report what it moved");
  let source_tree = tree(&source_dir);
  let destination_tree = tree(&destination_dir);
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert_eq!(moved.error, None, "a cancel is not an error");
  let record = moved.merge.expect("the move should report its merge");
  assert!(record.moved_items.is_empty());
  assert!(record.removed_folders.is_empty());
  assert_eq!(source_tree, ["photos/", "photos/new.txt=new"]);
  assert_eq!(destination_tree, ["photos/", "photos/keep.txt=keep"]);
}

#[test]
fn move_across_devices_leaves_an_existing_destination_alone() {
  let test_root = unique_test_root("grayspace_cross_drive_existing");
  let (source_dir, destination_dir) = (test_root.join("source"), test_root.join("destination"));
  create_files(&source_dir, &[("item/new.txt", "new")]);
  create_files(&destination_dir, &[("item/keep.txt", "keep")]);

  let moved = move_whole(
    &source_dir.join("item"),
    &destination_dir.join("item"),
    copy_across_devices,
    &mut TransferProgress::silent(),
  );
  let source_tree = tree(&source_dir);
  let destination_tree = tree(&destination_dir);
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert!(moved.expect_err("an existing destination should be refused").contains("already exists"));
  assert_eq!(source_tree, ["item/", "item/new.txt=new"]);
  assert_eq!(destination_tree, ["item/", "item/keep.txt=keep"]);
}

#[cfg(target_os = "windows")]
#[test]
fn move_across_devices_removes_only_what_a_failed_copy_created() {
  let test_root = unique_test_root("grayspace_cross_drive_failure");
  let (source_dir, destination_dir) = (test_root.join("source"), test_root.join("destination"));
  create_files(&source_dir, &[("item/a.txt", "a"), ("item/b_locked.txt", "locked")]);
  create_files(&destination_dir, &[("keep.txt", "keep")]);
  let lock = lock_file(&under(&source_dir, "item/b_locked.txt"));

  let moved = move_whole(
    &source_dir.join("item"),
    &destination_dir.join("item"),
    copy_across_devices,
    &mut TransferProgress::silent(),
  );
  drop(lock);
  let source_tree = tree(&source_dir);
  let destination_tree = tree(&destination_dir);
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert!(moved.is_err());
  assert_eq!(source_tree, ["item/", "item/a.txt=a", "item/b_locked.txt=locked"]);
  assert_eq!(destination_tree, ["keep.txt=keep"]);
}

#[cfg(target_os = "windows")]
fn create_junction(link: &Path, target: &Path) -> bool {
  std::process::Command::new("cmd")
    .args(["/C", "mklink", "/J"])
    .arg(link)
    .arg(target)
    .output()
    .is_ok_and(|output| output.status.success())
}

#[cfg(target_os = "windows")]
fn is_link(path: &Path) -> bool {
  fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink())
}

#[cfg(target_os = "windows")]
#[test]
fn copy_merge_replaces_a_junction_instead_of_writing_through_it() {
  let test_root = unique_test_root("grayspace_merge_copy_junction");
  create_files(&test_root, &[
    ("outside/outside.txt", "outside"),
    ("source/photos/linked/new.txt", "new"),
    ("destination/photos/keep.txt", "keep"),
  ]);
  let linked_path = under(&test_root, "destination/photos/linked");
  if !create_junction(&linked_path, &test_root.join("outside")) {
    eprintln!("skipped: cannot create a junction here");
    fs::remove_dir_all(&test_root).expect("should clean up temp root");
    return;
  }

  copy_replacing(&under(&test_root, "source/photos"), &test_root.join("destination"));
  let linked_is_link = is_link(&linked_path);
  let outside_tree = tree(&test_root.join("outside"));
  let destination_tree = tree(&under(&test_root, "destination/photos"));
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert!(!linked_is_link, "the junction should be replaced by a copied folder");
  assert_eq!(outside_tree, ["outside.txt=outside"]);
  assert_eq!(destination_tree, ["keep.txt=keep", "linked/", "linked/new.txt=new"]);
}

#[cfg(target_os = "windows")]
#[test]
fn move_merge_neither_follows_a_junction_nor_puts_it_in_the_place_of_a_folder() {
  let test_root = unique_test_root("grayspace_merge_move_junction");
  create_files(&test_root, &[
    ("outside/secret.txt", "secret"),
    ("destination/photos/keep.txt", "keep"),
    ("destination/photos/linked/old.txt", "old"),
  ]);
  fs::create_dir_all(under(&test_root, "source/photos")).expect("should create source folder");
  let source_link_path = under(&test_root, "source/photos/linked");
  if !create_junction(&source_link_path, &test_root.join("outside")) {
    eprintln!("skipped: cannot create a junction here");
    fs::remove_dir_all(&test_root).expect("should clean up temp root");
    return;
  }

  let moved = move_replacing_or_error(&under(&test_root, "source/photos"), &test_root.join("destination"))
    .expect("a merge that stops at an error should still report what it moved");
  let source_link_is_link = is_link(&source_link_path);
  let outside_tree = tree(&test_root.join("outside"));
  let destination_tree = tree(&under(&test_root, "destination/photos"));
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  let error = moved.error.expect("the merge should stop at the junction");
  assert!(error.contains(&path_string(under(&test_root, "destination/photos/linked"))), "{error}");
  assert!(source_link_is_link, "the junction should stay where it was");
  assert_eq!(outside_tree, ["secret.txt=secret"]);
  assert_eq!(destination_tree, ["keep.txt=keep", "linked/", "linked/old.txt=old"]);
  assert!(moved.merge.expect("the move should report its merge").moved_items.is_empty());
}

#[cfg(target_os = "windows")]
#[test]
fn a_merge_across_drives_copies_a_linked_folder_and_leaves_what_it_leads_to_alone() {
  let test_root = unique_test_root("grayspace_merge_cross_drive_junction");
  create_files(&test_root, &[
    ("outside/secret.txt", "secret"),
    ("outside_too/other_secret.txt", "other secret"),
    ("source/photos/a.txt", "a"),
    ("destination/photos/keep.txt", "keep"),
    ("destination/photos/linked_onto_file", "a file"),
  ]);
  let photos = under(&test_root, "source/photos");
  if !create_junction(&photos.join("linked"), &test_root.join("outside"))
    || !create_junction(&photos.join("linked_onto_file"), &test_root.join("outside_too"))
  {
    eprintln!("skipped: cannot create a junction here");
    fs::remove_dir_all(&test_root).expect("should clean up temp root");
    return;
  }

  let merged = merge_move(
    &photos,
    &under(&test_root, "destination/photos"),
    copy_across_devices,
    &mut TransferProgress::silent(),
    &mut MergeRecord::default(),
  );
  let whole_tree = tree(&test_root);
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  // The links are copied as real folders and then removed; what they lead to is not touched.
  assert_eq!(merged, Ok(()));
  assert_eq!(whole_tree, [
    "destination/",
    "destination/photos/",
    "destination/photos/a.txt=a",
    "destination/photos/keep.txt=keep",
    "destination/photos/linked/",
    "destination/photos/linked/secret.txt=secret",
    "destination/photos/linked_onto_file/",
    "destination/photos/linked_onto_file/other_secret.txt=other secret",
    "outside/",
    "outside/secret.txt=secret",
    "outside_too/",
    "outside_too/other_secret.txt=other secret",
    "source/",
  ]);
}

/// A long name makes a copy that follows the link into itself fail at the path length limit
/// before it can overflow the stack.
#[cfg(target_os = "windows")]
fn looping_link_name() -> String {
  format!("loop_{}", "x".repeat(95))
}

#[cfg(target_os = "windows")]
#[test]
fn copy_refuses_a_link_to_the_folder_it_copies_into() {
  let test_root = unique_test_root("grayspace_copy_link_loop");
  create_files(&test_root, &[("source/photos/new.txt", "new"), ("destination/keep.txt", "keep")]);
  let link_path = under(&test_root, "source/photos").join(looping_link_name());
  if !create_junction(&link_path, &test_root.join("destination")) {
    eprintln!("skipped: cannot create a junction here");
    fs::remove_dir_all(&test_root).expect("should clean up temp root");
    return;
  }

  let copied = copy_item(
    &under(&test_root, "source/photos"),
    &test_root.join("destination"),
    ConflictPolicy::Fail,
    &mut TransferProgress::silent(),
  );
  let destination_tree = tree(&test_root.join("destination"));
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  let error = copied.expect_err("the copy should refuse to follow the link into itself");
  assert!(error.contains(&path_string(link_path)), "the error should name the link: {error}");
  // Like any copy that stops part way, it leaves the folder it had started.
  assert_eq!(destination_tree, ["keep.txt=keep", "photos/"]);
}

#[cfg(target_os = "windows")]
#[test]
fn copy_merge_refuses_a_link_to_the_folder_it_merges_into() {
  let test_root = unique_test_root("grayspace_merge_link_loop");
  create_files(&test_root, &[("source/photos/new.txt", "new"), ("destination/photos/keep.txt", "keep")]);
  let link_path = under(&test_root, "source/photos").join(looping_link_name());
  if !create_junction(&link_path, &under(&test_root, "destination/photos")) {
    eprintln!("skipped: cannot create a junction here");
    fs::remove_dir_all(&test_root).expect("should clean up temp root");
    return;
  }

  let copied = copy_replacing_or_error(&under(&test_root, "source/photos"), &test_root.join("destination"));
  let destination_tree = tree(&test_root.join("destination"));
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  let error = copied.expect_err("the merge should refuse to follow the link into itself");
  assert!(error.contains(&path_string(link_path)), "the error should name the link: {error}");
  assert_eq!(destination_tree, ["photos/", "photos/keep.txt=keep"]);
}

#[test]
fn replace_refuses_to_reach_the_source_inside_what_it_replaces_or_merges_into() {
  let test_root = unique_test_root("grayspace_merge_holder");
  create_files(&test_root, &[
    // Merging copy/X/X into copy/X would put its file X in the place of copy/X/X, the source.
    ("copy/X/X/keep.txt", "keep"),
    ("copy/X/X/X", "named like its folder"),
    // Merging move/X/X into move/X would merge move/X/X/X into move/X/X, the source.
    ("move/X/outer.txt", "outer"),
    ("move/X/X/a.txt", "a"),
    ("move/X/X/X/z.txt", "z inner"),
    ("move/X/X/z.txt", "z outer"),
    // Copying the file replace/X/X in the place of the folder replace/X would send the file to the
    // Recycle Bin with the folder. Moving it is refused the same way.
    ("replace/X/X", "a file in X"),
    // Without a child named X, merging flatten/X/X into flatten/X is a plain flatten.
    ("flatten/X/outer.txt", "outer"),
    ("flatten/X/X/a.txt", "a"),
  ]);
  let tree_before = tree(&test_root);
  let replace_source = under(&test_root, "replace/X/X");

  let copied = copy_replacing_or_error(&under(&test_root, "copy/X/X"), &test_root.join("copy")).map(|_| ());
  let moved = move_replacing_or_error(&under(&test_root, "move/X/X"), &test_root.join("move")).map(|_| ());
  let replaced_by_copy = copy_replacing_or_error(&replace_source, &test_root.join("replace")).map(|_| ());
  let replaced_by_move = move_replacing_or_error(&replace_source, &test_root.join("replace")).map(|_| ());
  let tree_after_refusals = tree(&test_root);
  let flattened = move_replacing_or_error(&under(&test_root, "flatten/X/X"), &test_root.join("flatten")).map(|_| ());
  let flattened_tree = tree(&test_root.join("flatten"));
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  for refused in [copied, moved, replaced_by_copy, replaced_by_move] {
    assert!(refused.expect_err("should be refused").contains("because it holds"));
  }
  assert_eq!(tree_after_refusals, tree_before);
  assert_eq!(flattened, Ok(()));
  assert_eq!(flattened_tree, ["X/", "X/a.txt=a", "X/outer.txt=outer"]);
}

#[cfg(target_os = "windows")]
#[test]
fn replace_puts_the_item_in_the_place_of_a_link_to_the_folder_that_holds_it() {
  let test_root = unique_test_root("grayspace_merge_link_holder");
  create_files(&test_root, &[
    ("data/X/keep.txt", "keep"),
    ("data/other.txt", "other"),
    ("copy/placeholder.txt", "placeholder"),
    ("move/placeholder.txt", "placeholder"),
  ]);
  // Both links lead to data, which holds data/X; replacing a link leaves data alone.
  let (copy_link, move_link) = (under(&test_root, "copy/X"), under(&test_root, "move/X"));
  if !create_junction(&copy_link, &test_root.join("data")) || !create_junction(&move_link, &test_root.join("data")) {
    eprintln!("skipped: cannot create a junction here");
    fs::remove_dir_all(&test_root).expect("should clean up temp root");
    return;
  }

  let copied = copy_replacing_or_error(&under(&test_root, "data/X"), &test_root.join("copy")).map(|_| ());
  let data_after_copy = tree(&test_root.join("data"));
  let moved = move_replacing_or_error(&under(&test_root, "data/X"), &test_root.join("move")).map(|moved| moved.error);
  let links_left = [is_link(&copy_link), is_link(&move_link)];
  let data_after_move = tree(&test_root.join("data"));
  let replaced_trees = [tree(&test_root.join("copy")), tree(&test_root.join("move"))];
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert_eq!(copied, Ok(()));
  assert_eq!(moved, Ok(None));
  assert_eq!(links_left, [false, false], "the links should be replaced by real folders");
  assert_eq!(data_after_copy, ["X/", "X/keep.txt=keep", "other.txt=other"]);
  assert_eq!(data_after_move, ["other.txt=other"]);
  for replaced_tree in replaced_trees {
    assert_eq!(replaced_tree, ["X/", "X/keep.txt=keep", "placeholder.txt=placeholder"]);
  }
}

#[test]
fn only_a_top_level_replace_puts_a_file_in_the_place_of_a_folder() {
  let test_root = unique_test_root("grayspace_merge_file_onto_folder");
  let (source_dir, destination_dir) = (test_root.join("source"), test_root.join("destination"));
  create_files(&source_dir, &[
    ("photos/stuff", "a file"),
    ("docs/notes/new.txt", "new"),
    ("build", "copied file"),
    ("dist", "moved file"),
  ]);
  create_files(&destination_dir, &[
    ("photos/stuff/a.txt", "a"),
    ("photos/stuff/sub/b.txt", "b"),
    ("docs/notes", "a file"),
    ("build/out.bin", "out"),
    ("dist/out.bin", "out"),
  ]);
  let destination_before = tree(&destination_dir);

  let copied = copy_replacing_or_error(&source_dir.join("photos"), &destination_dir);
  let moved = move_replacing_or_error(&source_dir.join("photos"), &destination_dir)
    .expect("a merge that stops at an error should still report what it moved");
  let destination_after_refusals = tree(&destination_dir);
  let folder_onto_file = copy_replacing_or_error(&source_dir.join("docs"), &destination_dir).map(|_| ());
  let top_level_copy = copy_replacing_or_error(&source_dir.join("build"), &destination_dir).map(|_| ());
  let top_level_move = move_replacing_or_error(&source_dir.join("dist"), &destination_dir).map(|moved| moved.error);
  let destination_tree = tree(&destination_dir);
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  let stuff = path_string(under(&destination_dir, "photos/stuff"));
  assert!(copied.expect_err("a copy merge should refuse").contains(&stuff));
  assert!(moved.error.is_some_and(|error| error.contains(&stuff)));
  assert_eq!(destination_after_refusals, destination_before);
  assert_eq!(folder_onto_file, Ok(()));
  assert_eq!(top_level_copy, Ok(()));
  assert_eq!(top_level_move, Ok(None));
  assert_eq!(destination_tree, [
    "build=copied file",
    "dist=moved file",
    "docs/",
    "docs/notes/",
    "docs/notes/new.txt=new",
    "photos/",
    "photos/stuff/",
    "photos/stuff/a.txt=a",
    "photos/stuff/sub/",
    "photos/stuff/sub/b.txt=b",
  ]);
}

#[test]
fn transfer_conflicts_tell_which_ones_merge_folders() {
  let test_root = unique_test_root("grayspace_merge_conflicts");
  create_files(&test_root, &[
    ("source/photos/a.txt", "a"),
    ("source/notes.txt", "new"),
    ("source/mixed/a.txt", "a"),
    ("destination/photos/b.txt", "b"),
    ("destination/notes.txt", "old"),
    ("destination/mixed", "a file"),
  ]);
  let sources = ["photos", "notes.txt", "mixed"].map(|name| path_string(under(&test_root, &format!("source/{name}"))));

  let conflicts = filesystem_transfer_conflicts(sources.to_vec(), path_string(test_root.join("destination")));
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  let conflicts: Vec<_> = conflicts.into_iter().map(|conflict| (conflict.path, conflict.merges_folders)).collect();
  let [photos, notes, mixed] = sources;
  assert_eq!(conflicts, [(photos, true), (notes, false), (mixed, false)]);
}

#[test]
fn two_replaces_staging_in_one_folder_at_once_get_different_names() {
  let test_root = unique_test_root("grayspace_merge_staging_names");
  fs::create_dir_all(&test_root).expect("should create temp root");
  // Neither has staged anything yet, as when transfers in two panes replace at the same moment.
  let first = super::super::replace::free_staging_path(&test_root.join("a.txt"));
  let second = super::super::replace::free_staging_path(&test_root.join("b.txt"));
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert_ne!(first, second);
}

#[cfg(target_os = "windows")]
#[test]
fn replace_refuses_a_link_that_the_source_is_reached_through() {
  let test_root = unique_test_root("grayspace_merge_link_on_source_path");
  create_files(&test_root, &[("data/L/keep.txt", "keep"), ("d/placeholder.txt", "placeholder")]);
  let link = under(&test_root, "d/L");
  if !create_junction(&link, &test_root.join("data")) {
    eprintln!("skipped: cannot create a junction here");
    fs::remove_dir_all(&test_root).expect("should clean up temp root");
    return;
  }

  // d/L/L is data/L, reached through the link the move would replace.
  let moved = move_replacing_or_error(&under(&test_root, "d/L/L"), &test_root.join("d")).map(|moved| moved.error);
  let link_left = is_link(&link);
  let data_left = tree(&test_root.join("data"));
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert!(moved.as_ref().is_err_and(|error| error.contains("holds")), "expected a refusal: {moved:?}");
  assert!(link_left, "the link should stay");
  assert_eq!(data_left, ["L/", "L/keep.txt=keep"]);
}
