use super::{
  copy_across_devices, copy_item, delete_paths_core, filesystem_transfer_conflicts, import_paths_core,
  move_item, move_whole, ConflictPolicy, TransferProgress,
};
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

fn move_path(source: &str, destination_dir: &str) -> Result<(), String> {
  move_item(Path::new(source), Path::new(destination_dir), None, ConflictPolicy::Fail, &mut TransferProgress::silent())
    .map(|_| ())
}

fn import_paths(paths: Vec<String>, destination_dir: &str) -> Result<(), String> {
  import_paths_core(&paths, Path::new(destination_dir), ConflictPolicy::Fail, &mut TransferProgress::silent())
    .map(|_| ())
}

fn delete_paths(paths: Vec<String>) -> Result<(), String> {
  delete_paths_core(paths)
}

#[test]
fn move_path_moves_file_into_destination_folder() {
  let test_root = unique_test_root("grayspace_move");
  let source_dir = test_root.join("source");
  let destination_dir = test_root.join("destination");
  let source_file = source_dir.join("notes.txt");

  fs::create_dir_all(&source_dir).expect("should create source dir");
  fs::create_dir_all(&destination_dir).expect("should create destination dir");
  fs::write(&source_file, "hello").expect("should create source file");

  let source = source_file.to_string_lossy().to_string();
  let destination = destination_dir.to_string_lossy().to_string();
  move_path(&source, &destination).expect("move_path should move file");

  assert!(!source_file.exists(), "source file should be moved out");
  assert!(
    destination_dir.join("notes.txt").exists(),
    "destination should contain moved file"
  );

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn move_path_rejects_moving_folder_into_descendant() {
  let test_root = unique_test_root("grayspace_move_descendant");
  let parent_dir = test_root.join("photos");
  let child_dir = parent_dir.join("archive");

  fs::create_dir_all(&child_dir).expect("should create nested directories");

  let source = parent_dir.to_string_lossy().to_string();
  let destination = child_dir.to_string_lossy().to_string();
  let result = move_path(&source, &destination);

  assert!(result.is_err());
  assert!(result
    .expect_err("should return an error")
    .contains("Cannot move a folder into itself or one of its descendants."));

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn move_path_rejects_destination_name_collision() {
  let test_root = unique_test_root("grayspace_move_collision");
  let source_dir = test_root.join("source");
  let destination_dir = test_root.join("destination");
  let source_file = source_dir.join("notes.txt");
  let destination_file = destination_dir.join("notes.txt");

  fs::create_dir_all(&source_dir).expect("should create source dir");
  fs::create_dir_all(&destination_dir).expect("should create destination dir");
  fs::write(&source_file, "source").expect("should create source file");
  fs::write(&destination_file, "destination").expect("should create destination file");

  let source = source_file.to_string_lossy().to_string();
  let destination = destination_dir.to_string_lossy().to_string();
  let result = move_path(&source, &destination);

  assert!(result.is_err());
  assert!(result
    .expect_err("should return an error")
    .contains("already exists in the destination folder"));
  assert!(source_file.exists(), "source file should remain in place");

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn move_path_rejects_missing_source() {
  let test_root = unique_test_root("grayspace_move_missing_source");
  let destination_dir = test_root.join("destination");
  let missing_source = test_root.join("does-not-exist.txt");

  fs::create_dir_all(&destination_dir).expect("should create destination dir");

  let source = missing_source.to_string_lossy().to_string();
  let destination = destination_dir.to_string_lossy().to_string();
  let result = move_path(&source, &destination);

  assert!(result.is_err());
  assert!(result
    .expect_err("should return an error")
    .contains("does not exist."));

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn move_across_devices_falls_back_to_copy_and_delete_for_file() {
  let test_root = unique_test_root("grayspace_move_cross_drive_file");
  let source_dir = test_root.join("source");
  let destination_dir = test_root.join("destination");
  let source_file = source_dir.join("notes.txt");
  let destination_file = destination_dir.join("notes.txt");

  fs::create_dir_all(&source_dir).expect("should create source dir");
  fs::create_dir_all(&destination_dir).expect("should create destination dir");
  fs::write(&source_file, "hello").expect("should create source file");

  move_whole(&source_file, &destination_file, copy_across_devices, &mut TransferProgress::silent())
    .expect("cross-device fallback should copy and delete source file");

  assert!(
    !source_file.exists(),
    "source file should be removed after fallback"
  );
  assert!(
    destination_file.exists(),
    "destination file should exist after fallback"
  );

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn move_across_devices_falls_back_to_copy_and_delete_for_directory() {
  let test_root = unique_test_root("grayspace_move_cross_drive_dir");
  let source_dir = test_root.join("source").join("assets");
  let nested_dir = source_dir.join("nested");
  let destination_dir = test_root.join("destination");
  let destination_path = destination_dir.join("assets");

  fs::create_dir_all(&nested_dir).expect("should create nested source dir");
  fs::create_dir_all(&destination_dir).expect("should create destination dir");
  fs::write(source_dir.join("root.txt"), "root").expect("should create source root file");
  fs::write(nested_dir.join("leaf.txt"), "leaf").expect("should create nested source file");

  move_whole(&source_dir, &destination_path, copy_across_devices, &mut TransferProgress::silent())
    .expect("cross-device fallback should copy and delete source directory");

  assert!(
    !source_dir.exists(),
    "source directory should be removed after fallback"
  );
  assert!(
    destination_path.join("root.txt").exists(),
    "destination directory should contain copied root file"
  );
  assert!(
    destination_path.join("nested").join("leaf.txt").exists(),
    "destination directory should contain copied nested file"
  );

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}


#[test]
fn delete_paths_removes_file() {
  let test_root = unique_test_root("grayspace_delete_file");
  let file_path = test_root.join("notes.txt");
  fs::create_dir_all(&test_root).expect("should create temp root");
  fs::write(&file_path, "remove me").expect("should create temp file");

  let delete_target = file_path.to_string_lossy().to_string();
  delete_paths(vec![delete_target]).expect("delete_paths should remove file");

  assert!(!file_path.exists(), "file should be removed");

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn delete_paths_removes_directory_recursively() {
  let test_root = unique_test_root("grayspace_delete_dir");
  let folder_path = test_root.join("workspace");
  let nested_path = folder_path.join("nested");
  fs::create_dir_all(&nested_path).expect("should create nested folders");
  fs::write(folder_path.join("root.txt"), "root").expect("should create root file");
  fs::write(nested_path.join("leaf.txt"), "leaf").expect("should create nested file");

  let delete_target = folder_path.to_string_lossy().to_string();
  delete_paths(vec![delete_target]).expect("delete_paths should remove folder recursively");

  assert!(
    !folder_path.exists(),
    "folder should be removed recursively"
  );

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn delete_paths_rejects_missing_path() {
  let test_root = unique_test_root("grayspace_delete_missing");
  let missing_path = test_root.join("missing.txt");
  let delete_target = missing_path.to_string_lossy().to_string();

  let result = delete_paths(vec![delete_target]);

  assert!(result.is_err());
  assert!(result
    .expect_err("should return an error")
    .contains("does not exist."));
}

#[test]
fn import_paths_copies_file_into_destination_folder() {
  let test_root = unique_test_root("grayspace_import_file");
  let source_dir = test_root.join("source");
  let destination_dir = test_root.join("destination");
  let source_file = source_dir.join("notes.txt");

  fs::create_dir_all(&source_dir).expect("should create source dir");
  fs::create_dir_all(&destination_dir).expect("should create destination dir");
  fs::write(&source_file, "hello").expect("should create source file");

  let source = source_file.to_string_lossy().to_string();
  let destination = destination_dir.to_string_lossy().to_string();
  import_paths(vec![source.clone()], &destination).expect("import_paths should copy file");

  assert!(
    source_file.exists(),
    "source file should remain in place after import"
  );
  assert!(
    destination_dir.join("notes.txt").exists(),
    "destination should contain imported file"
  );

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn import_paths_copies_directory_recursively() {
  let test_root = unique_test_root("grayspace_import_dir");
  let source_dir = test_root.join("assets");
  let nested_dir = source_dir.join("nested");
  let destination_dir = test_root.join("destination");

  fs::create_dir_all(&nested_dir).expect("should create nested source dirs");
  fs::create_dir_all(&destination_dir).expect("should create destination dir");
  fs::write(source_dir.join("root.txt"), "root").expect("should create source root file");
  fs::write(nested_dir.join("leaf.txt"), "leaf").expect("should create nested source file");

  let source = source_dir.to_string_lossy().to_string();
  let destination = destination_dir.to_string_lossy().to_string();
  import_paths(vec![source], &destination).expect("import_paths should copy directory");

  let imported_root = destination_dir.join("assets");
  assert!(
    imported_root.exists(),
    "destination should contain imported folder"
  );
  assert!(
    imported_root.join("root.txt").exists(),
    "destination should contain top-level file"
  );
  assert!(
    imported_root.join("nested").join("leaf.txt").exists(),
    "destination should contain nested file"
  );

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn import_paths_rejects_destination_name_collision() {
  let test_root = unique_test_root("grayspace_import_collision");
  let source_dir = test_root.join("source");
  let destination_dir = test_root.join("destination");
  let source_file = source_dir.join("notes.txt");
  let destination_file = destination_dir.join("notes.txt");

  fs::create_dir_all(&source_dir).expect("should create source dir");
  fs::create_dir_all(&destination_dir).expect("should create destination dir");
  fs::write(&source_file, "source").expect("should create source file");
  fs::write(&destination_file, "destination").expect("should create destination file");

  let source = source_file.to_string_lossy().to_string();
  let destination = destination_dir.to_string_lossy().to_string();
  let result = import_paths(vec![source], &destination);

  assert!(result.is_err());
  assert!(result
    .expect_err("should return an error")
    .contains("already exists in the destination folder"));
  assert!(source_file.exists(), "source file should remain in place");

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn import_paths_rejects_empty_input() {
  let test_root = unique_test_root("grayspace_import_empty");
  fs::create_dir_all(&test_root).expect("should create destination dir");

  let destination = test_root.to_string_lossy().to_string();
  let result = import_paths(Vec::new(), &destination);

  assert!(result.is_err());
  assert_eq!(
    result.expect_err("should return an error"),
    "No paths were provided for import."
  );

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn import_paths_rejects_destination_that_is_not_a_directory() {
  let test_root = unique_test_root("grayspace_import_bad_destination");
  let source_dir = test_root.join("source");
  let source_file = source_dir.join("notes.txt");
  let destination_file = test_root.join("destination.txt");

  fs::create_dir_all(&source_dir).expect("should create source dir");
  fs::write(&source_file, "hello").expect("should create source file");
  fs::write(&destination_file, "not a directory").expect("should create destination file");

  let source = source_file.to_string_lossy().to_string();
  let destination = destination_file.to_string_lossy().to_string();
  let result = import_paths(vec![source], &destination);

  assert!(result.is_err());
  assert_eq!(
    result.expect_err("should return an error"),
    "The destination must be an existing folder."
  );

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn import_paths_rejects_importing_folder_into_descendant() {
  let test_root = unique_test_root("grayspace_import_descendant");
  let source_dir = test_root.join("workspace");
  let nested_destination = source_dir.join("nested");

  fs::create_dir_all(&nested_destination).expect("should create source and nested destination");

  let source = source_dir.to_string_lossy().to_string();
  let destination = nested_destination.to_string_lossy().to_string();
  let result = import_paths(vec![source], &destination);

  assert!(result.is_err());
  assert!(result
    .expect_err("should return an error")
    .contains("Cannot copy a folder into itself or one of its descendants."));

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

fn create_conflict_fixture(prefix: &str) -> (PathBuf, PathBuf, PathBuf) {
  let test_root = unique_test_root(prefix);
  let source_dir = test_root.join("source");
  let destination_dir = test_root.join("destination");
  fs::create_dir_all(&source_dir).expect("should create source dir");
  fs::create_dir_all(&destination_dir).expect("should create destination dir");
  fs::write(source_dir.join("notes.txt"), "new").expect("should create source file");
  fs::write(destination_dir.join("notes.txt"), "old").expect("should create destination file");
  (test_root, source_dir, destination_dir)
}

#[test]
fn copy_item_keep_both_copies_under_a_new_name() {
  let (test_root, source_dir, destination_dir) = create_conflict_fixture("grayspace_copy_policies");
  let source_file = source_dir.join("notes.txt");

  let kept = copy_item(&source_file, &destination_dir, ConflictPolicy::KeepBoth, &mut TransferProgress::silent())
    .expect("keep both should succeed")
    .expect("keep both should copy");

  let original = fs::read_to_string(destination_dir.join("notes.txt")).expect("original should remain");
  let copied = fs::read_to_string(&kept).expect("copy should exist");
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert_eq!(kept.file_name().and_then(|name| name.to_str()), Some("notes.001.txt"));
  assert_eq!(original, "old");
  assert_eq!(copied, "new");
}

#[test]
fn copy_item_into_its_own_folder_keeps_both_even_when_failing_on_conflicts() {
  let (test_root, source_dir, _) = create_conflict_fixture("grayspace_copy_same_folder");

  let copied = copy_item(&source_dir.join("notes.txt"), &source_dir, ConflictPolicy::Fail, &mut TransferProgress::silent())
    .expect("self copy should succeed")
    .expect("self copy should create a file");
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert_eq!(copied.file_name().and_then(|name| name.to_str()), Some("notes.001.txt"));
}

#[test]
fn move_item_is_a_no_op_for_items_already_in_place_and_fails_on_conflicts() {
  let (test_root, source_dir, destination_dir) = create_conflict_fixture("grayspace_move_policies");
  let source_file = source_dir.join("notes.txt");

  let conflict = move_item(&source_file, &destination_dir, None, ConflictPolicy::Fail, &mut TransferProgress::silent());
  let in_place = move_item(&source_file, &source_dir, None, ConflictPolicy::Fail, &mut TransferProgress::silent())
    .expect("moving into the same folder should be a no-op");
  let source_still_exists = source_file.exists();
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert!(conflict.is_err());
  assert_eq!(in_place.destination, None);
  assert!(source_still_exists);
}

#[test]
fn move_item_puts_the_item_under_the_target_name_as_undo_and_redo_of_keep_both_do() {
  let (test_root, source_dir, destination_dir) = create_conflict_fixture("grayspace_move_target_name");
  let move_named = |source: &Path, destination_dir: &Path, target_name: Option<&str>, policy: ConflictPolicy| {
    move_item(source, destination_dir, target_name, policy, &mut TransferProgress::silent())
  };
  let kept_file = destination_dir.join("notes.001.txt");

  let kept = move_named(&source_dir.join("notes.txt"), &destination_dir, None, ConflictPolicy::KeepBoth)
    .expect("keep both should move the file");
  let undone = move_named(&kept_file, &source_dir, Some("notes.txt"), ConflictPolicy::Fail)
    .expect("undo should move the file back under its own name");
  let source_names = file_names(&source_dir);
  let redone = move_named(&source_dir.join("notes.txt"), &destination_dir, Some("notes.001.txt"), ConflictPolicy::Fail)
    .expect("redo should move the file under the name keep both gave it");
  let taken = move_named(&kept_file, &destination_dir, Some("notes.txt"), ConflictPolicy::Fail);
  let mut destination_names = file_names(&destination_dir);
  destination_names.sort();
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  let path_of = |path: PathBuf| Some(path.to_string_lossy().to_string());
  assert_eq!(kept.destination, path_of(kept_file.clone()));
  assert_eq!(undone.destination, path_of(source_dir.join("notes.txt")));
  assert_eq!(source_names, ["notes.txt"]);
  assert_eq!(redone.destination, path_of(kept_file));
  assert!(taken.err().is_some_and(|error| error.contains("already exists")), "the target name should be taken");
  assert_eq!(destination_names, ["notes.001.txt", "notes.txt"]);
}

fn file_names(dir: &Path) -> Vec<String> {
  fs::read_dir(dir)
    .expect("should list folder")
    .map(|entry| entry.expect("should read entry").file_name().to_string_lossy().to_string())
    .collect()
}

#[test]
fn copy_item_and_move_item_replace_put_the_new_file_in_the_place_of_the_old_one() {
  let (test_root, source_dir, destination_dir) = create_conflict_fixture("grayspace_replace");
  let source_file = source_dir.join("notes.txt");
  let destination_file = destination_dir.join("notes.txt");

  let copied = copy_item(&source_file, &destination_dir, ConflictPolicy::Replace, &mut TransferProgress::silent())
    .expect("replacing copy should succeed");
  let copied_contents = fs::read_to_string(&destination_file).expect("copy should exist");
  fs::write(&destination_file, "old").expect("should put the old file back");
  let moved = move_item(&source_file, &destination_dir, None, ConflictPolicy::Replace, &mut TransferProgress::silent())
    .expect("replacing move should succeed");
  let moved_contents = fs::read_to_string(&destination_file).expect("moved file should exist");
  let destination_names = file_names(&destination_dir);
  let source_still_exists = source_file.exists();
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert_eq!(copied, Some(destination_file.clone()));
  assert_eq!(copied_contents, "new");
  assert_eq!(moved.destination, Some(destination_file.to_string_lossy().to_string()));
  assert_eq!(moved_contents, "new");
  assert!(!source_still_exists);
  assert_eq!(destination_names, ["notes.txt"]);
}

#[cfg(target_os = "windows")]
#[test]
fn replace_keeps_the_old_file_when_the_new_one_cannot_be_copied_or_moved_next_to_it() {
  use std::os::windows::fs::OpenOptionsExt;

  let (test_root, source_dir, destination_dir) = create_conflict_fixture("grayspace_replace_failure");
  let source_file = source_dir.join("notes.txt");
  // Without any sharing nothing can read or move the file while this handle is open.
  let lock = fs::OpenOptions::new().read(true).share_mode(0).open(&source_file).expect("should lock the file");

  let copied = copy_item(&source_file, &destination_dir, ConflictPolicy::Replace, &mut TransferProgress::silent());
  let moved = move_item(&source_file, &destination_dir, None, ConflictPolicy::Replace, &mut TransferProgress::silent());
  drop(lock);
  let destination_contents = fs::read_to_string(destination_dir.join("notes.txt")).expect("old file should remain");
  let destination_names = file_names(&destination_dir);
  let source_contents = fs::read_to_string(&source_file).expect("source should remain");
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  let source = source_file.to_string_lossy().to_string();
  assert!(copied.expect_err("copying a locked file should fail").contains(&source));
  assert!(moved.err().is_some_and(|error| error.contains(&source)));
  assert_eq!(destination_contents, "old");
  assert_eq!(destination_names, ["notes.txt"]);
  assert_eq!(source_contents, "new");
}

#[test]
fn transfer_conflicts_lists_sources_whose_name_is_taken() {
  let (test_root, source_dir, destination_dir) = create_conflict_fixture("grayspace_transfer_conflicts");
  fs::write(source_dir.join("unique.txt"), "").expect("should create unique file");
  let path_of = |path: PathBuf| path.to_string_lossy().to_string();

  let conflicts = filesystem_transfer_conflicts(
    vec![path_of(source_dir.join("notes.txt")), path_of(source_dir.join("unique.txt"))],
    path_of(destination_dir.clone()),
  );
  let same_folder_conflicts = filesystem_transfer_conflicts(
    vec![path_of(source_dir.join("notes.txt"))],
    path_of(source_dir.clone()),
  );
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  let conflicting_paths: Vec<_> = conflicts.into_iter().map(|conflict| conflict.path).collect();
  assert_eq!(conflicting_paths, vec![path_of(source_dir.join("notes.txt"))]);
  assert!(same_folder_conflicts.is_empty());
}

#[test]
fn import_paths_core_counts_bytes_and_items() {
  let test_root = unique_test_root("grayspace_import_progress");
  let source_dir = test_root.join("source");
  let destination_dir = test_root.join("destination");
  fs::create_dir_all(source_dir.join("nested")).expect("should create source dirs");
  fs::create_dir_all(&destination_dir).expect("should create destination dir");
  fs::write(source_dir.join("nested").join("a.bin"), [0u8; 1000]).expect("should create a.bin");
  fs::write(source_dir.join("b.bin"), [0u8; 24]).expect("should create b.bin");
  let mut progress = TransferProgress::silent();

  let result = import_paths_core(
    &[source_dir.to_string_lossy().to_string()],
    &destination_dir,
    ConflictPolicy::Fail,
    &mut progress,
  )
  .expect("import should succeed");
  let copied_nested = destination_dir.join("source").join("nested").join("a.bin").exists();
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert_eq!(result.copied_paths.len(), 1);
  assert!(copied_nested);
  assert_eq!(progress.bytes_total, 1024);
  assert_eq!(progress.bytes_done, 1024);
  assert_eq!(progress.items_done, 1);
}
