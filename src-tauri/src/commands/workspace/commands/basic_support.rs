use super::super::model::{PaneState, WorkspaceTab};
use super::super::types::{FilesystemPaneState, TabSelectedFilesState};
use std::collections::HashSet;

pub(super) struct PanePanelTypeUpdate {
  pub(super) changed: bool,
  pub(super) terminal_session_to_stop: Option<String>,
}

pub(super) fn select_tab_pane_mut<'a>(
  tab: &'a mut WorkspaceTab,
  pane: &str,
) -> Result<&'a mut PaneState, String> {
  match pane {
    "left" => Ok(&mut tab.pane_states.left),
    "right" => Ok(&mut tab.pane_states.right),
    _ => Err("Unsupported pane identifier.".to_string()),
  }
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

fn normalize_selected_paths(
  selected_path: String,
  selected_paths: Vec<String>,
) -> (String, Vec<String>) {
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

  if !selected_path.is_empty() && seen_paths.insert(selected_path.clone()) {
    normalized_selected_paths.push(selected_path.clone());
  }

  let normalized_selected_path = if selected_path.is_empty() {
    normalized_selected_paths.last().cloned().unwrap_or_default()
  } else {
    selected_path
  };

  (normalized_selected_path, normalized_selected_paths)
}

fn normalize_filesystem_state(state: FilesystemPaneState) -> FilesystemPaneState {
  let FilesystemPaneState {
    current_drive,
    current_path,
    selected_path,
    selected_paths,
    scroll_top,
  } = state;
  let (normalized_selected_path, normalized_selected_paths) =
    normalize_selected_paths(selected_path, selected_paths);

  FilesystemPaneState {
    current_drive,
    current_path,
    selected_path: normalized_selected_path,
    selected_paths: normalized_selected_paths,
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
  let TabSelectedFilesState {
    selected_path,
    selected_paths,
  } = state;
  let (selected_path, selected_paths) = normalize_selected_paths(selected_path, selected_paths);
  TabSelectedFilesState {
    selected_path,
    selected_paths,
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

#[cfg(test)]
mod tests {
  use super::{
    update_pane_filesystem_state, update_pane_panel_type, update_tab_selected_files,
    update_tab_workspace_root,
  };
  use crate::commands::workspace::model::WorkspaceModel;
  use crate::commands::workspace::types::{FilesystemPaneState, TabSelectedFilesState};

  #[test]
  fn update_pane_filesystem_state_detects_real_changes() {
    let mut model = WorkspaceModel::default();
    let mut tab = model.create_default_tab();

    let left_pane = &mut tab.pane_states.left;
    assert!(!update_pane_filesystem_state(
      left_pane,
      FilesystemPaneState::default()
    ));

    assert!(update_pane_filesystem_state(
      left_pane,
      FilesystemPaneState {
        current_drive: "C:\\".to_string(),
        current_path: "C:\\Users".to_string(),
        selected_path: "C:\\Users\\todo.txt".to_string(),
        selected_paths: vec!["C:\\Users\\todo.txt".to_string()],
        scroll_top: 125.7,
      },
    ));
    assert_eq!(left_pane.filesystem_state.current_path, "C:\\Users");
    assert_eq!(left_pane.filesystem_state.scroll_top, 125.7);

    assert!(update_pane_filesystem_state(
      left_pane,
      FilesystemPaneState {
        current_drive: "C:\\".to_string(),
        current_path: "C:\\Users".to_string(),
        selected_path: "C:\\Users\\todo.txt".to_string(),
        selected_paths: vec!["C:\\Users\\todo.txt".to_string()],
        scroll_top: f64::NAN,
      },
    ));
    assert_eq!(left_pane.filesystem_state.scroll_top, 0.0);
  }

  #[test]
  fn update_pane_filesystem_state_normalizes_multi_selection() {
    let mut model = WorkspaceModel::default();
    let mut tab = model.create_default_tab();
    let left_pane = &mut tab.pane_states.left;

    assert!(update_pane_filesystem_state(
      left_pane,
      FilesystemPaneState {
        current_drive: "C:\\".to_string(),
        current_path: "C:\\Users".to_string(),
        selected_path: String::new(),
        selected_paths: vec![
          "C:\\Users\\alpha.txt".to_string(),
          "C:\\Users\\alpha.txt".to_string(),
          "C:\\Users\\beta.txt".to_string(),
        ],
        scroll_top: 1.0,
      },
    ));

    assert_eq!(
      left_pane.filesystem_state.selected_paths,
      vec![
        "C:\\Users\\alpha.txt".to_string(),
        "C:\\Users\\beta.txt".to_string(),
      ]
    );
    assert_eq!(left_pane.filesystem_state.selected_path, "C:\\Users\\beta.txt");
  }

  #[test]
  fn update_pane_panel_type_stops_terminal_only_when_leaving_terminal() {
    let mut model = WorkspaceModel::default();
    let mut tab = model.create_default_tab();
    tab.pane_states.left.panel_type = "Terminal".to_string();
    let terminal_session_id = tab.pane_states.left.terminal_session_id.clone();

    let update = update_pane_panel_type(&mut tab.pane_states.left, "Preview".to_string());
    assert!(update.changed);
    assert_eq!(update.terminal_session_to_stop, Some(terminal_session_id));
    assert_eq!(tab.pane_states.left.panel_type, "Preview");

    let no_change = update_pane_panel_type(&mut tab.pane_states.left, "Preview".to_string());
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
    assert_eq!(tab.workspace_root.as_deref(), Some("C:\\Projects\\grayspace"));
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
        selected_path: String::new(),
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
    assert_eq!(tab.selected_files.selected_path, "C:\\Users\\draft.md");

    assert!(!update_tab_selected_files(
      &mut tab,
      TabSelectedFilesState {
        selected_path: "C:\\Users\\draft.md".to_string(),
        selected_paths: vec![
          "C:\\Users\\todo.txt".to_string(),
          "C:\\Users\\draft.md".to_string(),
        ],
      },
    ));

    assert!(update_tab_selected_files(
      &mut tab,
      TabSelectedFilesState {
        selected_path: String::new(),
        selected_paths: Vec::new(),
      },
    ));
    assert_eq!(tab.selected_files.selected_path, "");
    assert!(tab.selected_files.selected_paths.is_empty());
  }
}
