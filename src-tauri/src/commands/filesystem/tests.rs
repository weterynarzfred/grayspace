use super::watcher::{
  create_filesystem_watcher, drain_watchers_in_path_tree, remap_path_prefix, watch_state_key,
  ManagedFilesystemWatcher,
};
use super::listing::{build_directory_page, filter_entries, read_sorted_directory_entries, ListingSort};
use super::{
  create_folder, create_text_file, filesystem_get_properties, filesystem_resolve_workspace_folders,
  list_directory, parent_path, rename_path_core,
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

#[test]
fn list_directory_sorts_directories_before_files() {
  let test_root = unique_test_root("grayspace_test");
  fs::create_dir_all(&test_root).expect("should create temp root");
  fs::create_dir(test_root.join("b_dir")).expect("should create b_dir");
  fs::create_dir(test_root.join("A_dir")).expect("should create A_dir");
  fs::write(test_root.join("b.txt"), "b").expect("should create b.txt");
  fs::write(test_root.join("A.txt"), "a").expect("should create A.txt");

  let test_root_path = test_root.to_string_lossy().to_string();
  let entries = list_directory(&test_root_path, None, None).expect("list_directory should succeed");
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
  let entries = read_sorted_directory_entries(&test_root_path, ListingSort::default())
    .expect("read_sorted_directory_entries should succeed");
  let visible_entries = filter_entries(&entries, "", true);
  let first_page = build_directory_page(&visible_entries, 0, 2);
  let second_page = build_directory_page(&visible_entries, 2, 2);

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
  let all_entries = list_directory(&test_root_path, None, None).expect("list_directory should succeed");
  let expected_names: Vec<String> = all_entries.into_iter().map(|entry| entry.name).collect();

  let entries = read_sorted_directory_entries(&test_root_path, ListingSort::default())
    .expect("read_sorted_directory_entries should succeed");
  let visible_entries = filter_entries(&entries, "", true);
  let first_page = build_directory_page(&visible_entries, 0, 2);
  let second_page = build_directory_page(&visible_entries, 2, 2);
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

  let result = list_directory(&missing_path, None, None);
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

