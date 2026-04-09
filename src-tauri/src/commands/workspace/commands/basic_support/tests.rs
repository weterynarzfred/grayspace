use super::{
  close_layout_leaf, count_layout_leaves, layout_contains_pane, split_layout_leaf,
  update_layout_split_ratio, update_pane_filesystem_state, update_pane_panel_type,
  update_tab_selected_files, update_tab_workspace_root,
};
use crate::commands::workspace::model::WorkspaceModel;
use crate::commands::workspace::types::{
  FilesystemPaneState, SplitDirection, TabLayoutNode, TabSelectedFilesState,
};

#[test]
fn update_pane_filesystem_state_detects_real_changes() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();
  let active_pane_id = tab.active_pane_id.clone();

  let active_pane = tab
    .pane_states
    .get_mut(&active_pane_id)
    .expect("active pane should exist");
  assert!(!update_pane_filesystem_state(
    active_pane,
    FilesystemPaneState::default()
  ));

  assert!(update_pane_filesystem_state(
    active_pane,
    FilesystemPaneState {
      current_drive: "C:\\".to_string(),
      current_path: "C:\\Users".to_string(),
      selected_paths: vec!["C:\\Users\\todo.txt".to_string()],
      expanded_paths: vec!["C:\\Users".to_string()],
      scroll_top: 125.7,
      thumbnail_size_px: 64,
    },
  ));
  assert_eq!(active_pane.filesystem_state.current_path, "C:\\Users");
  assert_eq!(active_pane.filesystem_state.scroll_top, 125.7);
  assert_eq!(active_pane.filesystem_state.thumbnail_size_px, 64);

  assert!(update_pane_filesystem_state(
    active_pane,
    FilesystemPaneState {
      current_drive: "C:\\".to_string(),
      current_path: "C:\\Users".to_string(),
      selected_paths: vec!["C:\\Users\\todo.txt".to_string()],
      expanded_paths: vec!["C:\\Users".to_string()],
      scroll_top: f64::NAN,
      thumbnail_size_px: 33,
    },
  ));
  assert_eq!(active_pane.filesystem_state.scroll_top, 0.0);
  assert_eq!(active_pane.filesystem_state.thumbnail_size_px, 32);
}

#[test]
fn update_pane_filesystem_state_normalizes_multi_selection() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();
  let active_pane_id = tab.active_pane_id.clone();
  let active_pane = tab
    .pane_states
    .get_mut(&active_pane_id)
    .expect("active pane should exist");

  assert!(update_pane_filesystem_state(
    active_pane,
    FilesystemPaneState {
      current_drive: "C:\\".to_string(),
      current_path: "C:\\Users".to_string(),
      selected_paths: vec![
        "C:\\Users\\alpha.txt".to_string(),
        "C:\\Users\\alpha.txt".to_string(),
        "C:\\Users\\beta.txt".to_string(),
      ],
      expanded_paths: vec![
        "C:\\Users".to_string(),
        "C:\\Users".to_string(),
        "C:\\Users\\Projects".to_string(),
      ],
      scroll_top: 1.0,
      thumbnail_size_px: 256,
    },
  ));

  assert_eq!(
    active_pane.filesystem_state.selected_paths,
    vec![
      "C:\\Users\\alpha.txt".to_string(),
      "C:\\Users\\beta.txt".to_string(),
    ]
  );
  assert_eq!(
    active_pane.filesystem_state.expanded_paths,
    vec!["C:\\Users".to_string(), "C:\\Users\\Projects".to_string()]
  );
  assert_eq!(active_pane.filesystem_state.thumbnail_size_px, 256);
}

#[test]
fn update_pane_panel_type_stops_terminal_only_when_leaving_terminal() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();
  let active_pane_id = tab.active_pane_id.clone();
  {
    let active_pane = tab
      .pane_states
      .get_mut(&active_pane_id)
      .expect("active pane should exist");
    active_pane.panel_type = "Terminal".to_string();
  }
  let terminal_session_id = tab
    .pane_states
    .get(&active_pane_id)
    .expect("active pane should exist")
    .terminal_session_id
    .clone();

  let update = update_pane_panel_type(
    tab
      .pane_states
      .get_mut(&active_pane_id)
      .expect("active pane should exist"),
    "Preview".to_string(),
  );
  assert!(update.changed);
  assert_eq!(update.terminal_session_to_stop, Some(terminal_session_id));
  assert_eq!(
    tab
      .pane_states
      .get(&active_pane_id)
      .expect("active pane should exist")
      .panel_type,
    "Preview"
  );

  let no_change = update_pane_panel_type(
    tab
      .pane_states
      .get_mut(&active_pane_id)
      .expect("active pane should exist"),
    "Preview".to_string(),
  );
  assert!(!no_change.changed);
  assert_eq!(no_change.terminal_session_to_stop, None);
}

#[test]
fn update_tab_workspace_root_detects_changes() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();

  assert!(!update_tab_workspace_root(&mut tab, None));
  assert!(update_tab_workspace_root(
    &mut tab,
    Some("C:\\Projects\\grayspace".to_string())
  ));
  assert_eq!(
    tab.workspace_root.as_deref(),
    Some("C:\\Projects\\grayspace")
  );
  assert!(!update_tab_workspace_root(
    &mut tab,
    Some("C:\\Projects\\grayspace".to_string())
  ));
}

#[test]
fn update_tab_selected_files_normalizes_and_detects_changes() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();

  assert!(!update_tab_selected_files(
    &mut tab,
    TabSelectedFilesState::default()
  ));

  assert!(update_tab_selected_files(
    &mut tab,
    TabSelectedFilesState {
      selected_paths: vec![
        "C:\\Users\\todo.txt".to_string(),
        "C:\\Users\\todo.txt".to_string(),
        "C:\\Users\\draft.md".to_string(),
      ],
    },
  ));
  assert_eq!(
    tab.selected_files.selected_paths,
    vec![
      "C:\\Users\\todo.txt".to_string(),
      "C:\\Users\\draft.md".to_string(),
    ]
  );

  assert!(!update_tab_selected_files(
    &mut tab,
    TabSelectedFilesState {
      selected_paths: vec![
        "C:\\Users\\todo.txt".to_string(),
        "C:\\Users\\draft.md".to_string(),
      ],
    },
  ));

  assert!(update_tab_selected_files(
    &mut tab,
    TabSelectedFilesState {
      selected_paths: Vec::new(),
    },
  ));
  assert!(tab.selected_files.selected_paths.is_empty());
}

#[test]
fn split_layout_leaf_adds_new_pane_and_close_collapses_parent() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();
  let source_pane_id = tab.active_pane_id.clone();
  let new_pane_id = "pane-new".to_string();

  assert!(split_layout_leaf(
    &mut tab.layout,
    &source_pane_id,
    SplitDirection::Bottom,
    &new_pane_id,
  ));
  assert!(layout_contains_pane(&tab.layout, &source_pane_id));
  assert!(layout_contains_pane(&tab.layout, &new_pane_id));
  assert_eq!(count_layout_leaves(&tab.layout), 3);

  let replacement = close_layout_leaf(&mut tab.layout, &new_pane_id)
    .expect("closing a non-last pane should succeed");
  assert_eq!(replacement.as_deref(), Some(source_pane_id.as_str()));
  assert!(!layout_contains_pane(&tab.layout, &new_pane_id));
  assert_eq!(count_layout_leaves(&tab.layout), 2);
}

#[test]
fn close_layout_leaf_rejects_last_pane() {
  let mut layout = TabLayoutNode::Leaf {
    pane_id: "only-pane".to_string(),
  };
  let result = close_layout_leaf(&mut layout, "only-pane");
  assert!(result.is_err());
}

#[test]
fn update_layout_split_ratio_updates_target_split() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();

  let root_update_changed = update_layout_split_ratio(&mut tab.layout, "root", 72)
    .expect("root split ratio update should succeed");
  assert!(root_update_changed);

  let root_update_no_change = update_layout_split_ratio(&mut tab.layout, "root", 72)
    .expect("same ratio update should still succeed");
  assert!(!root_update_no_change);

  let source_pane_id = tab.active_pane_id.clone();
  assert!(split_layout_leaf(
    &mut tab.layout,
    &source_pane_id,
    SplitDirection::Bottom,
    "pane-nested",
  ));

  let nested_update_changed = update_layout_split_ratio(&mut tab.layout, "root-first", 15)
    .expect("nested split ratio update should succeed");
  assert!(nested_update_changed);

  match &tab.layout {
    TabLayoutNode::Split { ratio, first, .. } => {
      assert_eq!(*ratio, 72);
      match first.as_ref() {
        TabLayoutNode::Split { ratio, .. } => assert_eq!(*ratio, 15),
        _ => panic!("expected nested split in first branch"),
      }
    }
    _ => panic!("expected root split layout"),
  }
}

#[test]
fn update_layout_split_ratio_rejects_invalid_paths() {
  let mut model = WorkspaceModel::default();
  let mut tab = model.create_default_tab();

  let invalid_root_result = update_layout_split_ratio(&mut tab.layout, "main", 60);
  assert!(invalid_root_result.is_err());

  let leaf_path_result = update_layout_split_ratio(&mut tab.layout, "root-first", 60);
  assert!(leaf_path_result.is_err());
}
