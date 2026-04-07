use super::{
  build_directory_page, read_sorted_directory_entries,
  create_filesystem_watcher, drain_watchers_in_path_tree,
  create_folder, create_text_file,
  delete_paths, filesystem_get_properties, filesystem_resolve_workspace_folders,
  handle_move_rename_error, import_paths, list_directory, move_path, parent_path, remap_path_prefix, rename_path_core,
  watch_state_key, ManagedFilesystemWatcher,
};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_test_root(prefix: &str) -> PathBuf {
  let unique_id = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("system time should be after unix epoch")
    .as_nanos();
  std::env::temp_dir().join(format!("{prefix}_{unique_id}"))
}

#[cfg(target_os = "windows")]
const CROSS_DEVICE_ERROR_CODE: i32 = 17;
#[cfg(not(target_os = "windows"))]
const CROSS_DEVICE_ERROR_CODE: i32 = 18;

#[cfg(target_os = "windows")]
const NON_CROSS_DEVICE_ERROR_CODE: i32 = 5;
#[cfg(not(target_os = "windows"))]
const NON_CROSS_DEVICE_ERROR_CODE: i32 = 13;

#[test]
fn list_directory_sorts_directories_before_files() {
  let test_root = unique_test_root("grayspace_test");
  fs::create_dir_all(&test_root).expect("should create temp root");
  fs::create_dir(test_root.join("b_dir")).expect("should create b_dir");
  fs::create_dir(test_root.join("A_dir")).expect("should create A_dir");
  fs::write(test_root.join("b.txt"), "b").expect("should create b.txt");
  fs::write(test_root.join("A.txt"), "a").expect("should create A.txt");

  let test_root_path = test_root.to_string_lossy().to_string();
  let entries = list_directory(&test_root_path).expect("list_directory should succeed");
  let ordered_names: Vec<String> = entries.into_iter().map(|entry| entry.name).collect();

  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert_eq!(ordered_names, vec!["A_dir", "b_dir", "A.txt", "b.txt"]);
}

#[test]
fn list_directory_page_returns_limited_chunk_with_has_more() {
  let test_root = unique_test_root("grayspace_page");
  fs::create_dir_all(&test_root).expect("should create temp root");
  fs::write(test_root.join("a.txt"), "a").expect("should create a.txt");
  fs::write(test_root.join("b.txt"), "b").expect("should create b.txt");
  fs::write(test_root.join("c.txt"), "c").expect("should create c.txt");

  let test_root_path = test_root.to_string_lossy().to_string();
  let entries = read_sorted_directory_entries(&test_root_path)
    .expect("read_sorted_directory_entries should succeed");
  let first_page = build_directory_page(&entries, 0, 2);
  let second_page = build_directory_page(&entries, 2, 2);

  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert_eq!(first_page.entries.len(), 2);
  assert!(first_page.has_more);
  assert_eq!(second_page.entries.len(), 1);
  assert!(!second_page.has_more);
}

#[test]
fn list_directory_page_preserves_directory_first_sorting() {
  let test_root = unique_test_root("grayspace_page_sorted");
  fs::create_dir_all(&test_root).expect("should create temp root");
  fs::create_dir(test_root.join("b_dir")).expect("should create b_dir");
  fs::create_dir(test_root.join("A_dir")).expect("should create A_dir");
  fs::write(test_root.join("b.txt"), "b").expect("should create b.txt");
  fs::write(test_root.join("A.txt"), "a").expect("should create A.txt");

  let test_root_path = test_root.to_string_lossy().to_string();
  let all_entries = list_directory(&test_root_path).expect("list_directory should succeed");
  let expected_names: Vec<String> = all_entries.into_iter().map(|entry| entry.name).collect();

  let entries = read_sorted_directory_entries(&test_root_path)
    .expect("read_sorted_directory_entries should succeed");
  let first_page = build_directory_page(&entries, 0, 2);
  let second_page = build_directory_page(&entries, 2, 2);
  let mut paged_names: Vec<String> = first_page.entries.into_iter().map(|entry| entry.name).collect();
  paged_names.extend(second_page.entries.into_iter().map(|entry| entry.name));

  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  assert_eq!(paged_names, expected_names);
}

#[cfg(target_os = "windows")]
#[test]
fn parent_path_handles_windows_paths() {
  assert_eq!(
    parent_path(r"C:\Users\alice"),
    Some(r"C:\Users".to_string())
  );
  assert_eq!(parent_path(r"C:\"), None);
}

#[cfg(target_os = "windows")]
#[test]
fn parent_path_drive_root_edge_cases() {
  assert_eq!(parent_path(r"C:\\"), None);
  assert_eq!(parent_path(r"D:\"), None);
  assert_eq!(
    parent_path(r"C:\Users\alice\"),
    Some(r"C:\Users".to_string())
  );
}

#[cfg(not(target_os = "windows"))]
#[test]
fn parent_path_handles_unix_paths() {
  assert_eq!(parent_path("/usr/local"), Some("/usr".to_string()));
  assert_eq!(parent_path("/"), None);
}

#[test]
fn parent_path_handles_relative_paths() {
  let path = PathBuf::from("foo").join("bar");
  let path_string = path.to_string_lossy().to_string();
  assert_eq!(parent_path(&path_string), Some("foo".to_string()));
}

#[test]
fn list_directory_returns_error_for_missing_path() {
  let missing_path = unique_test_root("grayspace_missing")
    .to_string_lossy()
    .to_string();

  let result = list_directory(&missing_path);
  assert!(result.is_err());
}

#[test]
fn filesystem_resolve_workspace_folders_detects_direct_grayspace_child() {
  let test_root = unique_test_root("grayspace_workspace_marker");
  let workspace_dir = test_root.join("workspace");
  let plain_dir = test_root.join("plain");
  let non_existing_dir = test_root.join("missing");

  fs::create_dir_all(workspace_dir.join(".grayspace")).expect("should create workspace marker");
  fs::create_dir_all(&plain_dir).expect("should create plain directory");

  let result = filesystem_resolve_workspace_folders(vec![
    workspace_dir.to_string_lossy().to_string(),
    plain_dir.to_string_lossy().to_string(),
    non_existing_dir.to_string_lossy().to_string(),
  ]);

  assert_eq!(
    result.get(&workspace_dir.to_string_lossy().to_string()),
    Some(&true)
  );
  assert_eq!(result.get(&plain_dir.to_string_lossy().to_string()), Some(&false));
  assert_eq!(
    result.get(&non_existing_dir.to_string_lossy().to_string()),
    Some(&false)
  );

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn filesystem_get_properties_returns_file_details() {
  let test_root = unique_test_root("grayspace_properties_file");
  let file_path = test_root.join("notes.txt");

  fs::create_dir_all(&test_root).expect("should create temp root");
  fs::write(&file_path, "hello").expect("should write test file");

  let file_path_string = file_path.to_string_lossy().to_string();
  let properties = filesystem_get_properties(&file_path_string)
    .expect("filesystem_get_properties should read file metadata");

  assert_eq!(properties.path, file_path_string);
  assert_eq!(properties.entry_type, "TXT file");
  assert_eq!(properties.size_bytes, Some(5));
  assert!(
    properties.date_modified_ms.is_some(),
    "file modified date should be available"
  );

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn filesystem_get_properties_returns_folder_details() {
  let test_root = unique_test_root("grayspace_properties_folder");
  let folder_path = test_root.join("assets");

  fs::create_dir_all(&folder_path).expect("should create test folder");

  let folder_path_string = folder_path.to_string_lossy().to_string();
  let properties = filesystem_get_properties(&folder_path_string)
    .expect("filesystem_get_properties should read folder metadata");

  assert_eq!(properties.path, folder_path_string);
  assert_eq!(properties.entry_type, "Folder");
  assert_eq!(properties.size_bytes, None);

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
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
  assert_eq!(
    result.expect_err("should return an error"),
    "The source path does not exist."
  );

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn rename_path_renames_file_when_target_name_is_available() {
  let test_root = unique_test_root("grayspace_rename_available");
  let source_file = test_root.join("notes.txt");

  fs::create_dir_all(&test_root).expect("should create temp root");
  fs::write(&source_file, "hello").expect("should create source file");

  let result = rename_path_core(&source_file.to_string_lossy(), "renamed.txt", None)
    .expect("rename_path should rename file");

  assert_eq!(result.name, "renamed.txt");
  assert_eq!(result.requested_name, "renamed.txt");
  assert!(!result.adjusted);
  assert!(test_root.join("renamed.txt").exists(), "renamed file should exist");
  assert!(!source_file.exists(), "source path should be renamed");

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn rename_path_appends_increment_suffix_when_target_exists() {
  let test_root = unique_test_root("grayspace_rename_collision");
  let source_file = test_root.join("notes.txt");
  let existing_file = test_root.join("draft.md");

  fs::create_dir_all(&test_root).expect("should create temp root");
  fs::write(&source_file, "hello").expect("should create source file");
  fs::write(&existing_file, "existing").expect("should create existing file");

  let result = rename_path_core(&source_file.to_string_lossy(), "draft.md", None)
    .expect("rename_path should auto-adjust colliding target");

  assert_eq!(result.name, "draft.001.md");
  assert_eq!(result.requested_name, "draft.md");
  assert!(result.adjusted);
  assert!(
    test_root.join("draft.001.md").exists(),
    "adjusted rename target should exist"
  );
  assert!(!source_file.exists(), "source path should be renamed");

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn rename_path_increments_existing_numeric_suffix_until_available() {
  let test_root = unique_test_root("grayspace_rename_increment");
  let source_file = test_root.join("notes.txt");
  let existing_file_a = test_root.join("draft.001.md");
  let existing_file_b = test_root.join("draft.002.md");

  fs::create_dir_all(&test_root).expect("should create temp root");
  fs::write(&source_file, "hello").expect("should create source file");
  fs::write(&existing_file_a, "existing").expect("should create first existing file");
  fs::write(&existing_file_b, "existing").expect("should create second existing file");

  let result = rename_path_core(&source_file.to_string_lossy(), "draft.001.md", None)
    .expect("rename_path should increment numeric suffix");

  assert_eq!(result.name, "draft.003.md");
  assert_eq!(result.requested_name, "draft.001.md");
  assert!(result.adjusted);
  assert!(
    test_root.join("draft.003.md").exists(),
    "incremented target should exist"
  );
  assert!(!source_file.exists(), "source path should be renamed");

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn rename_path_rejects_collisions_when_adjustment_is_disabled() {
  let test_root = unique_test_root("grayspace_rename_strict_collision");
  let source_file = test_root.join("notes.txt");
  let existing_file = test_root.join("draft.md");

  fs::create_dir_all(&test_root).expect("should create temp root");
  fs::write(&source_file, "hello").expect("should create source file");
  fs::write(&existing_file, "existing").expect("should create existing file");

  let result = rename_path_core(&source_file.to_string_lossy(), "draft.md", Some(false));

  assert!(result.is_err());
  assert!(result
    .expect_err("should reject strict collision")
    .contains("already exists"));
  assert!(source_file.exists(), "source file should remain in place");

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn create_text_file_creates_file_with_requested_name() {
  let test_root = unique_test_root("grayspace_create_text_file");
  fs::create_dir_all(&test_root).expect("should create temp root");

  let result = create_text_file(&test_root.to_string_lossy(), "untitled.txt", None)
    .expect("create_text_file should create file");

  assert_eq!(result.name, "untitled.txt");
  assert_eq!(result.requested_name, "untitled.txt");
  assert!(!result.adjusted);
  assert!(test_root.join("untitled.txt").is_file(), "text file should exist");

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn create_folder_adjusts_colliding_name() {
  let test_root = unique_test_root("grayspace_create_folder_collision");
  fs::create_dir_all(test_root.join("New folder")).expect("should create colliding folder");

  let result = create_folder(&test_root.to_string_lossy(), "New folder", None)
    .expect("create_folder should adjust colliding name");

  assert_eq!(result.requested_name, "New folder");
  assert_eq!(result.name, "New folder.001");
  assert!(result.adjusted);
  assert!(test_root.join("New folder.001").is_dir(), "adjusted folder should exist");

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn remap_path_prefix_updates_renamed_folder_and_descendants() {
  let source = PathBuf::from("C:\\Users");
  let destination = PathBuf::from("C:\\People");

  let remapped_root = remap_path_prefix(&source, &source, &destination);
  assert_eq!(remapped_root, destination);

  let source_child = PathBuf::from("C:\\Users\\docs\\note.txt");
  let remapped_child = remap_path_prefix(&source_child, &source, &destination);
  assert_eq!(remapped_child, PathBuf::from("C:\\People\\docs\\note.txt"));

  let outside_path = PathBuf::from("C:\\Other\\file.txt");
  let remapped_outside = remap_path_prefix(&outside_path, &source, &destination);
  assert_eq!(remapped_outside, outside_path);
}

#[test]
fn drain_watchers_in_path_tree_keeps_unrelated_watchers_active() {
  let test_root = unique_test_root("grayspace_rename_watchers");
  let source_dir = test_root.join("source");
  let child_dir = source_dir.join("nested");
  let outside_dir = test_root.join("outside");

  fs::create_dir_all(&child_dir).expect("should create source child dir");
  fs::create_dir_all(&outside_dir).expect("should create outside dir");

  let source_canonical = fs::canonicalize(&source_dir).expect("source path should canonicalize");
  let child_canonical = fs::canonicalize(&child_dir).expect("child path should canonicalize");
  let outside_canonical = fs::canonicalize(&outside_dir).expect("outside path should canonicalize");

  let mut watchers: HashMap<String, ManagedFilesystemWatcher> = HashMap::new();
  let make_watcher = || {
    create_filesystem_watcher(|_| {})
      .expect("watcher should initialize for test")
  };

  watchers.insert(
    watch_state_key("main", "root"),
    ManagedFilesystemWatcher {
      _watcher: make_watcher(),
      canonical_path: source_canonical.clone(),
      window_label: "main".to_string(),
      watch_id: "root".to_string(),
    },
  );
  watchers.insert(
    watch_state_key("main", "child"),
    ManagedFilesystemWatcher {
      _watcher: make_watcher(),
      canonical_path: child_canonical.clone(),
      window_label: "main".to_string(),
      watch_id: "child".to_string(),
    },
  );
  watchers.insert(
    watch_state_key("main", "outside"),
    ManagedFilesystemWatcher {
      _watcher: make_watcher(),
      canonical_path: outside_canonical.clone(),
      window_label: "main".to_string(),
      watch_id: "outside".to_string(),
    },
  );

  let suspended = drain_watchers_in_path_tree(&mut watchers, &source_canonical);
  let suspended_ids: Vec<String> = suspended
    .iter()
    .map(|watcher| watcher.watch_id.clone())
    .collect();

  assert_eq!(suspended.len(), 2);
  assert!(suspended_ids.contains(&"root".to_string()));
  assert!(suspended_ids.contains(&"child".to_string()));
  assert_eq!(watchers.len(), 1);
  assert!(watchers
    .get(&watch_state_key("main", "outside"))
    .map(|watcher| watcher.watch_id.as_str())
    == Some("outside"));

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}

#[test]
fn handle_move_rename_error_falls_back_to_copy_and_delete_for_file() {
  let test_root = unique_test_root("grayspace_move_cross_drive_file");
  let source_dir = test_root.join("source");
  let destination_dir = test_root.join("destination");
  let source_file = source_dir.join("notes.txt");
  let destination_file = destination_dir.join("notes.txt");

  fs::create_dir_all(&source_dir).expect("should create source dir");
  fs::create_dir_all(&destination_dir).expect("should create destination dir");
  fs::write(&source_file, "hello").expect("should create source file");

  let rename_error = std::io::Error::from_raw_os_error(CROSS_DEVICE_ERROR_CODE);
  handle_move_rename_error(&source_file, &destination_file, rename_error)
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
fn handle_move_rename_error_falls_back_to_copy_and_delete_for_directory() {
  let test_root = unique_test_root("grayspace_move_cross_drive_dir");
  let source_dir = test_root.join("source").join("assets");
  let nested_dir = source_dir.join("nested");
  let destination_dir = test_root.join("destination");
  let destination_path = destination_dir.join("assets");

  fs::create_dir_all(&nested_dir).expect("should create nested source dir");
  fs::create_dir_all(&destination_dir).expect("should create destination dir");
  fs::write(source_dir.join("root.txt"), "root").expect("should create source root file");
  fs::write(nested_dir.join("leaf.txt"), "leaf").expect("should create nested source file");

  let rename_error = std::io::Error::from_raw_os_error(CROSS_DEVICE_ERROR_CODE);
  handle_move_rename_error(&source_dir, &destination_path, rename_error)
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
fn handle_move_rename_error_returns_original_error_when_not_cross_device() {
  let test_root = unique_test_root("grayspace_move_non_cross_error");
  let source_dir = test_root.join("source");
  let destination_dir = test_root.join("destination");
  let source_file = source_dir.join("notes.txt");
  let destination_file = destination_dir.join("notes.txt");

  fs::create_dir_all(&source_dir).expect("should create source dir");
  fs::create_dir_all(&destination_dir).expect("should create destination dir");
  fs::write(&source_file, "hello").expect("should create source file");

  let rename_error = std::io::Error::from_raw_os_error(NON_CROSS_DEVICE_ERROR_CODE);
  let result = handle_move_rename_error(&source_file, &destination_file, rename_error);

  assert!(
    result.is_err(),
    "non cross-device errors should be returned"
  );
  assert!(source_file.exists(), "source file should remain in place");
  assert!(
    !destination_file.exists(),
    "destination file should not be created"
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
    .contains("Cannot import a folder into itself or one of its descendants."));

  fs::remove_dir_all(&test_root).expect("should clean up temp root");
}
