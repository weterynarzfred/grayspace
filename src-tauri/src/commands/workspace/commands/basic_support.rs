use super::super::model::{PaneState, WorkspaceTab};
use super::super::types::{
  FilesystemPaneState, LayoutAxis, SplitDirection, TabLayoutNode, TabSelectedFilesState,
};
use std::collections::HashSet;

const FILESYSTEM_THUMBNAIL_SIZE_STEPS: [u32; 5] = [22, 32, 64, 128, 256];
const DEFAULT_FILESYSTEM_THUMBNAIL_SIZE_PX: u32 = FILESYSTEM_THUMBNAIL_SIZE_STEPS[0];

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

fn normalize_thumbnail_size_px(thumbnail_size_px: u32) -> u32 {
  if FILESYSTEM_THUMBNAIL_SIZE_STEPS.contains(&thumbnail_size_px) {
    thumbnail_size_px
  } else {
    DEFAULT_FILESYSTEM_THUMBNAIL_SIZE_PX
  }
}

fn normalize_filesystem_state(state: FilesystemPaneState) -> FilesystemPaneState {
  let FilesystemPaneState {
    current_drive,
    current_path,
    selected_paths,
    expanded_paths,
    scroll_top,
    thumbnail_size_px,
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
    thumbnail_size_px: normalize_thumbnail_size_px(thumbnail_size_px),
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

fn split_after_first_removed(
  axis: LayoutAxis,
  ratio: u8,
  first_result: RemoveLeafResult,
  second_node: TabLayoutNode,
) -> RemoveLeafResult {
  match first_result.node {
    Some(next_first) => RemoveLeafResult {
      node: Some(TabLayoutNode::Split {
        axis,
        ratio,
        first: Box::new(next_first),
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
}

fn split_after_second_removed(
  axis: LayoutAxis,
  ratio: u8,
  first_node: Option<TabLayoutNode>,
  second_result: RemoveLeafResult,
) -> RemoveLeafResult {
  match second_result.node {
    Some(next_second) => RemoveLeafResult {
      node: Some(TabLayoutNode::Split {
        axis,
        ratio,
        first: Box::new(first_node.expect("first node should remain")),
        second: Box::new(next_second),
      }),
      removed: true,
      replacement_pane_id: second_result.replacement_pane_id,
    },
    None => {
      let fallback_pane_id = second_result
        .replacement_pane_id
        .or_else(|| first_node.as_ref().and_then(find_first_layout_pane_id));
      RemoveLeafResult {
        node: first_node,
        removed: true,
        replacement_pane_id: fallback_pane_id,
      }
    }
  }
}

fn remove_layout_leaf(node: TabLayoutNode, target_pane_id: &str) -> RemoveLeafResult {
  match node {
    TabLayoutNode::Leaf { pane_id } => {
      if pane_id == target_pane_id {
        RemoveLeafResult { node: None, removed: true, replacement_pane_id: None }
      } else {
        RemoveLeafResult { node: Some(TabLayoutNode::Leaf { pane_id }), removed: false, replacement_pane_id: None }
      }
    }
    TabLayoutNode::Split { axis, ratio, first, second } => {
      let first_node = *first;
      let second_node = *second;
      let first_result = remove_layout_leaf(first_node, target_pane_id);

      if first_result.removed {
        return split_after_first_removed(axis, ratio, first_result, second_node);
      }

      let second_result = remove_layout_leaf(second_node, target_pane_id);
      if second_result.removed {
        return split_after_second_removed(axis, ratio, first_result.node, second_result);
      }

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
mod tests;
