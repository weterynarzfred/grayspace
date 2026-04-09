use super::{
  apply_tab_workspace_root_change, find_workspace_root_for_path, infer_drive_from_path,
  normalize_recent_folder_path, recent_folder_dedupe_key, reset_tab_layout_to_default,
  set_tab_filesystem_root,
};
use crate::commands::workspace::commands::basic_support::split_layout_leaf;
use crate::commands::workspace::model::WorkspaceModel;
use crate::commands::workspace::types::{
  LayoutAxis, SplitDirection, TabLayoutNode, DEFAULT_SPLIT_RATIO,
};
use std::collections::BTreeSet;
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
fn reset_tab_layout_to_default_recreates_standard_split() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();
  let source_pane_id = tab.active_pane_id.clone();
  let extra_pane_id = "pane-extra".to_string();
  assert!(split_layout_leaf(
    &mut tab.layout,
    &source_pane_id,
    SplitDirection::Bottom,
    &extra_pane_id,
  ));

  let extra_terminal_session_id = "term-old-extra".to_string();
  let extra_pane = tab
    .pane_states
    .get(&source_pane_id)
    .expect("source pane should exist")
    .clone();
  tab.pane_states.insert(
    extra_pane_id.clone(),
    crate::commands::workspace::model::PaneState {
      pane_id: extra_pane_id.clone(),
      panel_type: "Terminal".to_string(),
      terminal_session_id: extra_terminal_session_id.clone(),
      filesystem_state: extra_pane.filesystem_state,
    },
  );
  tab.active_pane_id = extra_pane_id.clone();
  if let Some(active_pane) = tab.pane_states.get_mut(&extra_pane_id) {
    active_pane.filesystem_state.current_drive = "C:\\".to_string();
    active_pane.filesystem_state.current_path = "C:\\Outside".to_string();
  }

  let old_session_ids = reset_tab_layout_to_default(
    &mut tab,
    "term-new-left".to_string(),
    "term-new-right".to_string(),
  );
  let old_session_id_set = old_session_ids.into_iter().collect::<BTreeSet<_>>();
  assert_eq!(old_session_id_set.len(), 3);
  assert!(old_session_id_set.contains(&extra_terminal_session_id));

  let expected_left_pane_id = format!("{}-left", tab.tab_id);
  let expected_right_pane_id = format!("{}-right", tab.tab_id);
  assert_eq!(tab.active_pane_id, expected_left_pane_id);
  assert_eq!(
    tab.pane_states.keys().cloned().collect::<BTreeSet<_>>(),
    [expected_left_pane_id.clone(), expected_right_pane_id.clone()]
      .into_iter()
      .collect()
  );

  match &tab.layout {
    TabLayoutNode::Split {
      axis,
      ratio,
      first,
      second,
    } => {
      assert_eq!(*axis, LayoutAxis::Row);
      assert_eq!(*ratio, DEFAULT_SPLIT_RATIO);
      match first.as_ref() {
        TabLayoutNode::Leaf { pane_id } => assert_eq!(pane_id, &expected_left_pane_id),
        _ => panic!("left branch should be a leaf"),
      }
      match second.as_ref() {
        TabLayoutNode::Leaf { pane_id } => assert_eq!(pane_id, &expected_right_pane_id),
        _ => panic!("right branch should be a leaf"),
      }
    }
    _ => panic!("default layout should be split"),
  }

  let left_pane = tab
    .pane_states
    .get(&expected_left_pane_id)
    .expect("left pane should exist");
  let right_pane = tab
    .pane_states
    .get(&expected_right_pane_id)
    .expect("right pane should exist");
  assert_eq!(left_pane.panel_type, "Filesystem");
  assert_eq!(left_pane.filesystem_state.current_path, "C:\\Outside");
  assert_eq!(right_pane.panel_type, "Preview");
}

#[test]
fn apply_tab_workspace_root_change_resets_layout_when_workspace_is_cleared() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();
  tab.workspace_root = Some("C:\\workspace".to_string());

  let source_pane_id = tab.active_pane_id.clone();
  let extra_pane_id = "pane-extra".to_string();
  assert!(split_layout_leaf(
    &mut tab.layout,
    &source_pane_id,
    SplitDirection::Bottom,
    &extra_pane_id,
  ));

  let extra_terminal_session_id = "term-old-extra".to_string();
  let extra_pane = tab
    .pane_states
    .get(&source_pane_id)
    .expect("source pane should exist")
    .clone();
  tab.pane_states.insert(
    extra_pane_id.clone(),
    crate::commands::workspace::model::PaneState {
      pane_id: extra_pane_id.clone(),
      panel_type: "Terminal".to_string(),
      terminal_session_id: extra_terminal_session_id.clone(),
      filesystem_state: extra_pane.filesystem_state,
    },
  );
  tab.active_pane_id = extra_pane_id.clone();
  if let Some(active_pane) = tab.pane_states.get_mut(&extra_pane_id) {
    active_pane.filesystem_state.current_drive = "C:\\".to_string();
    active_pane.filesystem_state.current_path = "C:\\Outside".to_string();
  }

  let tab_id = tab.tab_id.clone();
  model.tabs.insert(tab_id.clone(), tab);
  let (changed, old_session_ids) =
    apply_tab_workspace_root_change(&mut model, &tab_id, None).expect("update should succeed");
  assert!(changed);
  assert_eq!(old_session_ids.len(), 3);
  assert!(old_session_ids.contains(&extra_terminal_session_id));

  let updated_tab = model.tabs.get(&tab_id).expect("tab should exist");
  assert_eq!(updated_tab.workspace_root, None);

  let expected_left_pane_id = format!("{}-left", tab_id);
  let expected_right_pane_id = format!("{}-right", tab_id);
  assert_eq!(updated_tab.active_pane_id, expected_left_pane_id);
  assert_eq!(
    updated_tab.pane_states.keys().cloned().collect::<BTreeSet<_>>(),
    [expected_left_pane_id.clone(), expected_right_pane_id.clone()]
      .into_iter()
      .collect()
  );

  match &updated_tab.layout {
    TabLayoutNode::Split {
      axis,
      ratio,
      first,
      second,
    } => {
      assert_eq!(*axis, LayoutAxis::Row);
      assert_eq!(*ratio, DEFAULT_SPLIT_RATIO);
      match first.as_ref() {
        TabLayoutNode::Leaf { pane_id } => assert_eq!(pane_id, &expected_left_pane_id),
        _ => panic!("left branch should be a leaf"),
      }
      match second.as_ref() {
        TabLayoutNode::Leaf { pane_id } => assert_eq!(pane_id, &expected_right_pane_id),
        _ => panic!("right branch should be a leaf"),
      }
    }
    _ => panic!("default layout should be split"),
  }

  let left_pane = updated_tab
    .pane_states
    .get(&expected_left_pane_id)
    .expect("left pane should exist");
  let right_pane = updated_tab
    .pane_states
    .get(&expected_right_pane_id)
    .expect("right pane should exist");
  assert_eq!(left_pane.panel_type, "Filesystem");
  assert_eq!(left_pane.filesystem_state.current_path, "C:\\Outside");
  assert_eq!(right_pane.panel_type, "Preview");
}

#[test]
fn apply_tab_workspace_root_change_preserves_non_active_filesystem_path() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();
  tab.workspace_root = Some("H:\\gstest".to_string());
  tab.terminal_cwd_hint = "H:\\".to_string();

  let left_pane_id = tab.active_pane_id.clone();
  let right_pane_id = tab
    .pane_states
    .keys()
    .find(|pane_id| *pane_id != &left_pane_id)
    .expect("right pane should exist")
    .clone();

  if let Some(left_pane) = tab.pane_states.get_mut(&left_pane_id) {
    left_pane.panel_type = "Preview".to_string();
    left_pane.filesystem_state.current_path.clear();
    left_pane.filesystem_state.current_drive.clear();
  }
  if let Some(right_pane) = tab.pane_states.get_mut(&right_pane_id) {
    right_pane.panel_type = "Filesystem".to_string();
    right_pane.filesystem_state.current_drive = "H:\\".to_string();
    right_pane.filesystem_state.current_path = "H:\\".to_string();
  }

  let tab_id = tab.tab_id.clone();
  model.tabs.insert(tab_id.clone(), tab);
  let (changed, _) =
    apply_tab_workspace_root_change(&mut model, &tab_id, None).expect("update should succeed");
  assert!(changed);

  let updated_tab = model.tabs.get(&tab_id).expect("tab should exist");
  assert_eq!(updated_tab.workspace_root, None);

  let expected_left_pane_id = format!("{}-left", tab_id);
  let left_pane = updated_tab
    .pane_states
    .get(&expected_left_pane_id)
    .expect("left pane should exist");
  assert_eq!(left_pane.panel_type, "Filesystem");
  assert_eq!(left_pane.filesystem_state.current_drive, "H:\\");
  assert_eq!(left_pane.filesystem_state.current_path, "H:\\");
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
fn set_tab_filesystem_root_updates_all_filesystem_panes() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();
  let left_pane_id = tab.active_pane_id.clone();
  let right_pane_id = tab
    .pane_states
    .keys()
    .find(|pane_id| *pane_id != &left_pane_id)
    .expect("right pane should exist")
    .clone();

  {
    let right_pane = tab
      .pane_states
      .get_mut(&right_pane_id)
      .expect("right pane should exist");
    right_pane.panel_type = "Filesystem".to_string();
    right_pane.filesystem_state.current_path = "C:\\OldRight".to_string();
  }
  {
    let left_pane = tab
      .pane_states
      .get_mut(&left_pane_id)
      .expect("left pane should exist");
    left_pane.filesystem_state.current_path = "C:\\OldLeft".to_string();
  }

  set_tab_filesystem_root(&mut tab, "C:\\Workspace\\Nested");

  let left_pane = tab
    .pane_states
    .get(&left_pane_id)
    .expect("left pane should exist");
  let right_pane = tab
    .pane_states
    .get(&right_pane_id)
    .expect("right pane should exist");
  assert_eq!(left_pane.filesystem_state.current_path, "C:\\Workspace\\Nested");
  assert_eq!(right_pane.filesystem_state.current_path, "C:\\Workspace\\Nested");
  assert_eq!(left_pane.filesystem_state.current_drive, "C:\\");
  assert_eq!(right_pane.filesystem_state.current_drive, "C:\\");
}

#[test]
fn apply_tab_workspace_root_change_updates_root_without_layout_reset() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();
  tab.workspace_root = Some("C:\\workspace-old".to_string());
  tab.terminal_cwd_hint = "C:\\workspace-old".to_string();

  let tab_id = tab.tab_id.clone();
  let original_layout = tab.layout.clone();
  let original_active_pane_id = tab.active_pane_id.clone();
  let original_terminal_ids = tab
    .pane_states
    .values()
    .map(|pane_state| pane_state.terminal_session_id.clone())
    .collect::<BTreeSet<_>>();
  model.tabs.insert(tab_id.clone(), tab);

  let (changed, terminal_sessions_to_stop) = apply_tab_workspace_root_change(
    &mut model,
    &tab_id,
    Some("C:\\workspace-new".to_string()),
  )
  .expect("update should succeed");

  assert!(changed);
  assert!(terminal_sessions_to_stop.is_empty());

  let updated_tab = model.tabs.get(&tab_id).expect("tab should exist");
  assert_eq!(updated_tab.workspace_root.as_deref(), Some("C:\\workspace-new"));
  assert!(updated_tab.layout == original_layout);
  assert_eq!(updated_tab.active_pane_id, original_active_pane_id);
  assert_eq!(
    updated_tab
      .pane_states
      .values()
      .map(|pane_state| pane_state.terminal_session_id.clone())
      .collect::<BTreeSet<_>>(),
    original_terminal_ids
  );
}

#[test]
fn apply_tab_workspace_root_change_is_noop_for_same_root() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();
  tab.workspace_root = Some("C:\\workspace".to_string());

  let tab_id = tab.tab_id.clone();
  let original_terminal_ids = tab
    .pane_states
    .values()
    .map(|pane_state| pane_state.terminal_session_id.clone())
    .collect::<BTreeSet<_>>();
  model.tabs.insert(tab_id.clone(), tab);

  let (changed, terminal_sessions_to_stop) = apply_tab_workspace_root_change(
    &mut model,
    &tab_id,
    Some("C:\\workspace".to_string()),
  )
  .expect("update should succeed");

  assert!(!changed);
  assert!(terminal_sessions_to_stop.is_empty());

  let updated_tab = model.tabs.get(&tab_id).expect("tab should exist");
  assert_eq!(updated_tab.workspace_root.as_deref(), Some("C:\\workspace"));
  assert_eq!(
    updated_tab
      .pane_states
      .values()
      .map(|pane_state| pane_state.terminal_session_id.clone())
      .collect::<BTreeSet<_>>(),
    original_terminal_ids
  );
}

#[test]
fn apply_tab_workspace_root_change_errors_for_missing_tab() {
  let mut model = WorkspaceModel::default();
  let result = apply_tab_workspace_root_change(
    &mut model,
    "missing-tab",
    Some("C:\\workspace".to_string()),
  );
  assert!(result.is_err());
  assert_eq!(result.expect_err("missing tab should fail"), "Tab not found.");
}

#[test]
fn set_tab_filesystem_root_updates_active_pane_when_no_filesystem_panes_exist() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();
  let active_pane_id = tab.active_pane_id.clone();
  let inactive_pane_id = tab
    .pane_states
    .keys()
    .find(|pane_id| *pane_id != &active_pane_id)
    .expect("inactive pane should exist")
    .clone();

  {
    let active_pane = tab
      .pane_states
      .get_mut(&active_pane_id)
      .expect("active pane should exist");
    active_pane.panel_type = "Preview".to_string();
    active_pane.filesystem_state.selected_paths = vec!["C:\\Old\\selection.txt".to_string()];
    active_pane.filesystem_state.expanded_paths = vec!["C:\\Old".to_string()];
    active_pane.filesystem_state.scroll_top = 123.0;
  }
  {
    let inactive_pane = tab
      .pane_states
      .get_mut(&inactive_pane_id)
      .expect("inactive pane should exist");
    inactive_pane.panel_type = "Terminal".to_string();
    inactive_pane.filesystem_state.current_path = "C:\\Unchanged".to_string();
    inactive_pane.filesystem_state.current_drive = "C:\\".to_string();
  }

  set_tab_filesystem_root(&mut tab, "D:\\Workspace\\Nested");

  let active_pane = tab
    .pane_states
    .get(&active_pane_id)
    .expect("active pane should exist");
  let inactive_pane = tab
    .pane_states
    .get(&inactive_pane_id)
    .expect("inactive pane should exist");
  assert_eq!(active_pane.filesystem_state.current_drive, "D:\\");
  assert_eq!(active_pane.filesystem_state.current_path, "D:\\Workspace\\Nested");
  assert!(active_pane.filesystem_state.selected_paths.is_empty());
  assert!(active_pane.filesystem_state.expanded_paths.is_empty());
  assert_eq!(active_pane.filesystem_state.scroll_top, 0.0);

  assert_eq!(inactive_pane.filesystem_state.current_drive, "C:\\");
  assert_eq!(inactive_pane.filesystem_state.current_path, "C:\\Unchanged");
}

#[test]
fn normalize_recent_folder_path_and_dedupe_key_handle_trailing_separators() {
  assert_eq!(
    normalize_recent_folder_path("  C:\\Workspace\\Project\\\\  "),
    "C:\\Workspace\\Project"
  );
  assert_eq!(normalize_recent_folder_path("   "), "");

  #[cfg(target_os = "windows")]
  {
    assert_eq!(normalize_recent_folder_path("C:\\"), "C:\\");
    assert_eq!(
      recent_folder_dedupe_key(" C:/Workspace/Project/ "),
      "c:\\workspace\\project"
    );
  }

  #[cfg(not(target_os = "windows"))]
  {
    assert_eq!(normalize_recent_folder_path("///"), "/");
    assert_eq!(recent_folder_dedupe_key(" /tmp/workspace/project/ "), "/tmp/workspace/project");
  }
}

#[test]
fn infer_drive_from_path_extracts_drive_or_root() {
  assert_eq!(infer_drive_from_path("  "), "");

  #[cfg(target_os = "windows")]
  {
    assert_eq!(infer_drive_from_path("C:\\Workspace\\Project"), "C:\\");
    assert_eq!(infer_drive_from_path("c:/workspace/project"), "C:\\");
    assert_eq!(
      infer_drive_from_path("\\\\server\\share\\workspace\\project"),
      "\\\\server\\share"
    );
  }

  #[cfg(not(target_os = "windows"))]
  {
    assert_eq!(infer_drive_from_path("/tmp/workspace/project"), "/");
    assert_eq!(infer_drive_from_path("relative/path"), "");
  }
}
