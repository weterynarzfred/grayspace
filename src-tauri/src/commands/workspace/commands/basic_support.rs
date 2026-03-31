use super::super::model::{PaneState, WorkspaceTab};
use super::super::types::{
  FilesystemPaneState, LayoutAxis, SplitDirection, TabLayoutNode, TabSelectedFilesState,
};
use std::collections::HashSet;

pub(super) struct PanePanelTypeUpdate {
  pub(super) changed: bool,
  pub(super) terminal_session_to_stop: Option<String>,
}

pub(super) fn select_tab_pane_mut<'a>(
  tab: &'a mut WorkspaceTab,
  pane_id: &str,
) -> Result<&'a mut PaneState, String> {
  tab
    .pane_states
    .get_mut(pane_id)
    .ok_or_else(|| "Pane not found.".to_string())
}

pub(super) fn select_tab_pane<'a>(
  tab: &'a WorkspaceTab,
  pane_id: &str,
) -> Result<&'a PaneState, String> {
  tab
    .pane_states
    .get(pane_id)
    .ok_or_else(|| "Pane not found.".to_string())
}

pub(super) fn update_pane_panel_type(
  target_pane: &mut PaneState,
  next_panel_type: String,
) -> PanePanelTypeUpdate {
  let previous_panel_type = target_pane.panel_type.clone();
  let changed = previous_panel_type != next_panel_type;
  if changed {
    target_pane.panel_type = next_panel_type.clone();
  }

  let terminal_session_to_stop =
    if previous_panel_type == "Terminal" && next_panel_type != "Terminal" {
      Some(target_pane.terminal_session_id.clone())
    } else {
      None
    };

  PanePanelTypeUpdate {
    changed,
    terminal_session_to_stop,
  }
}

fn normalize_selected_paths(selected_paths: Vec<String>) -> Vec<String> {
  let mut seen_paths = HashSet::new();
  let mut normalized_selected_paths = Vec::new();

  for path in selected_paths {
    if path.is_empty() {
      continue;
    }
    if seen_paths.insert(path.clone()) {
      normalized_selected_paths.push(path);
    }
  }

  normalized_selected_paths
}

fn normalize_filesystem_state(state: FilesystemPaneState) -> FilesystemPaneState {
  let FilesystemPaneState {
    current_drive,
    current_path,
    selected_paths,
    expanded_paths,
    scroll_top,
  } = state;
  let normalized_selected_paths = normalize_selected_paths(selected_paths);
  let normalized_expanded_paths = normalize_selected_paths(expanded_paths);

  FilesystemPaneState {
    current_drive,
    current_path,
    selected_paths: normalized_selected_paths,
    expanded_paths: normalized_expanded_paths,
    scroll_top: if scroll_top.is_finite() {
      scroll_top.max(0.0)
    } else {
      0.0
    },
  }
}

pub(super) fn update_pane_filesystem_state(
  target_pane: &mut PaneState,
  next_state: FilesystemPaneState,
) -> bool {
  let normalized_state = normalize_filesystem_state(next_state);
  if target_pane.filesystem_state == normalized_state {
    return false;
  }
  target_pane.filesystem_state = normalized_state;
  true
}

fn normalize_tab_selected_files_state(state: TabSelectedFilesState) -> TabSelectedFilesState {
  TabSelectedFilesState {
    selected_paths: normalize_selected_paths(state.selected_paths),
  }
}

pub(super) fn update_tab_selected_files(
  tab: &mut WorkspaceTab,
  next_state: TabSelectedFilesState,
) -> bool {
  let normalized_state = normalize_tab_selected_files_state(next_state);
  if tab.selected_files == normalized_state {
    return false;
  }
  tab.selected_files = normalized_state;
  true
}

pub(super) fn update_tab_workspace_root(
  tab: &mut WorkspaceTab,
  workspace_root: Option<String>,
) -> bool {
  if tab.workspace_root == workspace_root {
    return false;
  }
  tab.workspace_root = workspace_root;
  true
}

pub(super) fn layout_contains_pane(layout: &TabLayoutNode, pane_id: &str) -> bool {
  match layout {
    TabLayoutNode::Leaf {
      pane_id: layout_pane_id,
    } => layout_pane_id == pane_id,
    TabLayoutNode::Split { first, second, .. } => {
      layout_contains_pane(first, pane_id) || layout_contains_pane(second, pane_id)
    }
  }
}

pub(super) fn find_first_layout_pane_id(layout: &TabLayoutNode) -> Option<String> {
  match layout {
    TabLayoutNode::Leaf { pane_id } => Some(pane_id.clone()),
    TabLayoutNode::Split { first, .. } => find_first_layout_pane_id(first),
  }
}

pub(super) fn count_layout_leaves(layout: &TabLayoutNode) -> usize {
  match layout {
    TabLayoutNode::Leaf { .. } => 1,
    TabLayoutNode::Split { first, second, .. } => {
      count_layout_leaves(first) + count_layout_leaves(second)
    }
  }
}

pub(super) fn split_layout_leaf(
  layout: &mut TabLayoutNode,
  target_pane_id: &str,
  direction: SplitDirection,
  new_pane_id: &str,
) -> bool {
  match layout {
    TabLayoutNode::Leaf { pane_id } if pane_id == target_pane_id => {
      let original_pane_id = pane_id.clone();
      let axis = match direction {
        SplitDirection::Right => LayoutAxis::Row,
        SplitDirection::Bottom => LayoutAxis::Column,
      };
      *layout = TabLayoutNode::Split {
        axis,
        ratio: 50,
        first: Box::new(TabLayoutNode::Leaf {
          pane_id: original_pane_id,
        }),
        second: Box::new(TabLayoutNode::Leaf {
          pane_id: new_pane_id.to_string(),
        }),
      };
      true
    }
    TabLayoutNode::Leaf { .. } => false,
    TabLayoutNode::Split { first, second, .. } => {
      split_layout_leaf(first, target_pane_id, direction, new_pane_id)
        || split_layout_leaf(second, target_pane_id, direction, new_pane_id)
    }
  }
}

pub(super) fn update_layout_split_ratio(
  layout: &mut TabLayoutNode,
  split_path: &str,
  ratio: u8,
) -> Result<bool, String> {
  let mut path_segments = split_path.split('-');
  if path_segments.next() != Some("root") {
    return Err("Invalid split path.".to_string());
  }

  let mut current_node = layout;
  for segment in path_segments {
    current_node = match current_node {
      TabLayoutNode::Split { first, second, .. } => match segment {
        "first" => first.as_mut(),
        "second" => second.as_mut(),
        _ => return Err("Invalid split path.".to_string()),
      },
      TabLayoutNode::Leaf { .. } => return Err("Invalid split path.".to_string()),
    };
  }

  let clamped_ratio = ratio.clamp(10, 90);
  match current_node {
    TabLayoutNode::Split { ratio, .. } => {
      if *ratio == clamped_ratio {
        Ok(false)
      } else {
        *ratio = clamped_ratio;
        Ok(true)
      }
    }
    TabLayoutNode::Leaf { .. } => Err("Split path points to a leaf pane.".to_string()),
  }
}

struct RemoveLeafResult {
  node: Option<TabLayoutNode>,
  removed: bool,
  replacement_pane_id: Option<String>,
}

fn remove_layout_leaf(node: TabLayoutNode, target_pane_id: &str) -> RemoveLeafResult {
  match node {
    TabLayoutNode::Leaf { pane_id } => {
      if pane_id == target_pane_id {
        RemoveLeafResult {
          node: None,
          removed: true,
          replacement_pane_id: None,
        }
      } else {
        RemoveLeafResult {
          node: Some(TabLayoutNode::Leaf { pane_id }),
          removed: false,
          replacement_pane_id: None,
        }
      }
    }
    TabLayoutNode::Split {
      axis,
      ratio,
      first,
      second,
    } => {
      let first_node = *first;
      let second_node = *second;
      let first_result = remove_layout_leaf(first_node, target_pane_id);

      if first_result.removed {
        match first_result.node {
          Some(next_first_node) => RemoveLeafResult {
            node: Some(TabLayoutNode::Split {
              axis,
              ratio,
              first: Box::new(next_first_node),
              second: Box::new(second_node),
            }),
            removed: true,
            replacement_pane_id: first_result.replacement_pane_id,
          },
          None => {
            let fallback_pane_id = first_result
              .replacement_pane_id
              .or_else(|| find_first_layout_pane_id(&second_node));
            RemoveLeafResult {
              node: Some(second_node),
              removed: true,
              replacement_pane_id: fallback_pane_id,
            }
          }
        }
      } else {
        let second_result = remove_layout_leaf(second_node, target_pane_id);
        if second_result.removed {
          match second_result.node {
            Some(next_second_node) => RemoveLeafResult {
              node: Some(TabLayoutNode::Split {
                axis,
                ratio,
                first: Box::new(first_result.node.expect("first node should remain")),
                second: Box::new(next_second_node),
              }),
              removed: true,
              replacement_pane_id: second_result.replacement_pane_id,
            },
            None => {
              let fallback_pane_id = second_result.replacement_pane_id.or_else(|| {
                first_result
                  .node
                  .as_ref()
                  .and_then(find_first_layout_pane_id)
              });
              RemoveLeafResult {
                node: first_result.node,
                removed: true,
                replacement_pane_id: fallback_pane_id,
              }
            }
          }
        } else {
          RemoveLeafResult {
            node: Some(TabLayoutNode::Split {
              axis,
              ratio,
              first: Box::new(first_result.node.expect("first node should remain")),
              second: Box::new(second_result.node.expect("second node should remain")),
            }),
            removed: false,
            replacement_pane_id: None,
          }
        }
      }
    }
  }
}

pub(super) fn close_layout_leaf(
  layout: &mut TabLayoutNode,
  target_pane_id: &str,
) -> Result<Option<String>, String> {
  let removal_result = remove_layout_leaf(layout.clone(), target_pane_id);
  if !removal_result.removed {
    return Err("Pane not found.".to_string());
  }

  let Some(next_layout) = removal_result.node else {
    return Err("Cannot close the last pane.".to_string());
  };

  *layout = next_layout;
  Ok(
    removal_result
      .replacement_pane_id
      .or_else(|| find_first_layout_pane_id(layout)),
  )
}

#[cfg(test)]
mod tests {
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
      },
    ));
    assert_eq!(active_pane.filesystem_state.current_path, "C:\\Users");
    assert_eq!(active_pane.filesystem_state.scroll_top, 125.7);

    assert!(update_pane_filesystem_state(
      active_pane,
      FilesystemPaneState {
        current_drive: "C:\\".to_string(),
        current_path: "C:\\Users".to_string(),
        selected_paths: vec!["C:\\Users\\todo.txt".to_string()],
        expanded_paths: vec!["C:\\Users".to_string()],
        scroll_top: f64::NAN,
      },
    ));
    assert_eq!(active_pane.filesystem_state.scroll_top, 0.0);
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
}
