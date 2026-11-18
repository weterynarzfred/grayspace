use super::{
  find_workspace_root_for_path, should_persist_workspace_panels_for_filesystem_state_change,
  workspace_read_folder_stylesheet,
};
use crate::commands::workspace::types::FilesystemPaneState;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{env, fs};

fn unique_test_root(prefix: &str) -> PathBuf {
  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("clock should be monotonic")
    .as_nanos();
  env::temp_dir().join(format!("{prefix}-{timestamp}"))
}

#[test]
fn find_workspace_root_for_path_detects_nearest_ancestor_workspace() {
  let test_root = unique_test_root("workspace-ancestor-detect");
  let workspace_root = test_root.join("WorkspaceRoot");
  let nested_folder = workspace_root.join("a").join("b");
  fs::create_dir_all(&nested_folder).expect("nested folder should be created");
  fs::create_dir_all(workspace_root.join(".grayspace")).expect("workspace marker should exist");

  let detected_workspace_root = find_workspace_root_for_path(&nested_folder)
    .expect("workspace root should be detected");
  assert_eq!(
    PathBuf::from(detected_workspace_root),
    workspace_root
  );

  fs::remove_dir_all(&test_root).expect("test root should be removed");
}

#[test]
fn find_workspace_root_for_path_returns_none_without_workspace_marker() {
  let test_root = unique_test_root("workspace-ancestor-missing");
  let nested_folder = test_root.join("x").join("y");
  fs::create_dir_all(&nested_folder).expect("nested folder should be created");

  let detected_workspace_root = find_workspace_root_for_path(&nested_folder);
  assert_eq!(detected_workspace_root, None);

  fs::remove_dir_all(&test_root).expect("test root should be removed");
}

#[test]
fn workspace_read_folder_stylesheet_reads_css_file_from_workspace_root() {
  let test_root = unique_test_root("workspace-read-stylesheet-css");
  let workspace_root = test_root.join("WorkspaceRoot");
  let stylesheet_path = workspace_root.join("user").join("styles.css");
  fs::create_dir_all(
    stylesheet_path
      .parent()
      .expect("stylesheet parent should exist"),
  )
  .expect("stylesheet directory should be created");
  fs::write(&stylesheet_path, ".workspaceContent { color: hotpink; }")
    .expect("stylesheet should be written");

  let result = workspace_read_folder_stylesheet(
    workspace_root.to_string_lossy().to_string(),
    "user/styles.css".to_string(),
  )
  .expect("command should succeed");

  assert_eq!(result.as_deref(), Some(".workspaceContent { color: hotpink; }"));
  fs::remove_dir_all(&test_root).expect("test root should be removed");
}

#[test]
fn workspace_read_folder_stylesheet_falls_back_to_scss_when_css_is_missing() {
  let test_root = unique_test_root("workspace-read-stylesheet-scss-fallback");
  let workspace_root = test_root.join("WorkspaceRoot");
  let stylesheet_path = workspace_root.join("user").join("styles.scss");
  fs::create_dir_all(
    stylesheet_path
      .parent()
      .expect("stylesheet parent should exist"),
  )
  .expect("stylesheet directory should be created");
  fs::write(&stylesheet_path, ".workspaceContent { color: springgreen; }")
    .expect("stylesheet should be written");

  let result = workspace_read_folder_stylesheet(
    workspace_root.to_string_lossy().to_string(),
    "user/styles.css".to_string(),
  )
  .expect("command should succeed");

  assert_eq!(result.as_deref(), Some(".workspaceContent { color: springgreen; }"));
  fs::remove_dir_all(&test_root).expect("test root should be removed");
}

#[test]
fn workspace_read_folder_stylesheet_rejects_parent_dir_traversal() {
  let test_root = unique_test_root("workspace-read-stylesheet-traversal");
  let workspace_root = test_root.join("WorkspaceRoot");
  fs::create_dir_all(workspace_root.join(".grayspace"))
    .expect("workspace marker should be created");

  let result = workspace_read_folder_stylesheet(
    workspace_root.to_string_lossy().to_string(),
    "../outside.css".to_string(),
  );

  assert_eq!(
    result.expect_err("parent traversal should be rejected"),
    "Stylesheet path must stay inside workspace root."
  );
  fs::remove_dir_all(&test_root).expect("test root should be removed");
}

#[test]
fn workspace_read_folder_stylesheet_reads_grayspace_file_when_explicitly_requested() {
  let test_root = unique_test_root("workspace-read-stylesheet-grayspace-path");
  let workspace_root = test_root.join("WorkspaceRoot");
  let stylesheet_path = workspace_root.join(".grayspace").join("user").join("styles.css");
  fs::create_dir_all(
    stylesheet_path
      .parent()
      .expect("stylesheet parent should exist"),
  )
  .expect("stylesheet directory should be created");
  fs::write(&stylesheet_path, ".workspaceContent { color: dodgerblue; }")
    .expect("stylesheet should be written");

  let result = workspace_read_folder_stylesheet(
    workspace_root.to_string_lossy().to_string(),
    ".grayspace/user/styles.css".to_string(),
  )
  .expect("command should succeed");

  assert_eq!(result.as_deref(), Some(".workspaceContent { color: dodgerblue; }"));
  fs::remove_dir_all(&test_root).expect("test root should be removed");
}

#[test]
fn workspace_panels_persist_only_for_durable_filesystem_state_changes() {
  let previous_state = FilesystemPaneState {
    current_drive: "C:\\".to_string(),
    current_path: "C:\\Workspace".to_string(),
    selected_paths: vec!["C:\\Workspace\\a.txt".to_string()],
    expanded_paths: vec!["C:\\Workspace".to_string()],
    scroll_top: 20.0,
    thumbnail_size_px: 64,
    view_type: "folder-tree".to_string(),
    sort_key: "name".to_string(),
    sort_descending: false,
    search_options: None,
  };

  let mut next_state = previous_state.clone();
  next_state.scroll_top = 120.0;
  assert!(!should_persist_workspace_panels_for_filesystem_state_change(
    &previous_state,
    &next_state,
  ));

  next_state = previous_state.clone();
  next_state.selected_paths = vec!["C:\\Workspace\\b.txt".to_string()];
  assert!(!should_persist_workspace_panels_for_filesystem_state_change(
    &previous_state,
    &next_state,
  ));

  next_state = previous_state.clone();
  next_state.current_path = "C:\\Workspace\\sub".to_string();
  assert!(should_persist_workspace_panels_for_filesystem_state_change(
    &previous_state,
    &next_state,
  ));

  next_state = previous_state.clone();
  next_state.expanded_paths.push("C:\\Workspace\\sub".to_string());
  assert!(should_persist_workspace_panels_for_filesystem_state_change(
    &previous_state,
    &next_state,
  ));

  next_state = previous_state.clone();
  next_state.thumbnail_size_px = 128;
  assert!(should_persist_workspace_panels_for_filesystem_state_change(
    &previous_state,
    &next_state,
  ));

  next_state = previous_state.clone();
  next_state.view_type = "grid".to_string();
  assert!(should_persist_workspace_panels_for_filesystem_state_change(
    &previous_state,
    &next_state,
  ));

  next_state = previous_state.clone();
  next_state.sort_key = "modified".to_string();
  assert!(should_persist_workspace_panels_for_filesystem_state_change(
    &previous_state,
    &next_state,
  ));

  next_state = previous_state.clone();
  next_state.sort_descending = true;
  assert!(should_persist_workspace_panels_for_filesystem_state_change(
    &previous_state,
    &next_state,
  ));

  next_state = previous_state.clone();
  next_state.search_options = Some(serde_json::json!({ "useRegex": true }));
  assert!(should_persist_workspace_panels_for_filesystem_state_change(
    &previous_state,
    &next_state,
  ));
}
