use super::super::model::{PaneState, WorkspaceState, WorkspaceTab};
use super::super::runtime_effects::{emit_workspace_updated, publish_snapshot};
use super::super::types::{
  FilesystemPaneState, NewWindowOptions, TabCwdPayload, TabPaneFilesystemStatePayload,
  TabPanelTypePayload, TabSelectedFilesPayload, TabSelectedFilesState, TabWorkspaceRootPayload,
  WindowBounds, WorkspaceBootstrapPayload, WorkspaceSnapshot, WorkspaceWindowCreationPayload,
};
use crate::commands::terminal::{stop_terminal_session_by_id, TerminalState};
use std::collections::HashSet;
use tauri::{AppHandle, State};

struct PanePanelTypeUpdate {
  changed: bool,
  terminal_session_to_stop: Option<String>,
}

fn select_tab_pane_mut<'a>(tab: &'a mut WorkspaceTab, pane: &str) -> Result<&'a mut PaneState, String> {
  match pane {
    "left" => Ok(&mut tab.pane_states.left),
    "right" => Ok(&mut tab.pane_states.right),
    _ => Err("Unsupported pane identifier.".to_string()),
  }
}

fn update_pane_panel_type(target_pane: &mut PaneState, next_panel_type: String) -> PanePanelTypeUpdate {
  let previous_panel_type = target_pane.panel_type.clone();
  let changed = previous_panel_type != next_panel_type;
  if changed {
    target_pane.panel_type = next_panel_type.clone();
  }
  let terminal_session_to_stop = if previous_panel_type == "Terminal" && next_panel_type != "Terminal" {
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

fn update_pane_filesystem_state(target_pane: &mut PaneState, next_state: FilesystemPaneState) -> bool {
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

fn update_tab_selected_files(tab: &mut WorkspaceTab, next_state: TabSelectedFilesState) -> bool {
  let normalized_state = normalize_tab_selected_files_state(next_state);
  if tab.selected_files == normalized_state {
    return false;
  }
  tab.selected_files = normalized_state;
  true
}

fn update_tab_workspace_root(tab: &mut WorkspaceTab, workspace_root: Option<String>) -> bool {
  if tab.workspace_root == workspace_root {
    return false;
  }
  tab.workspace_root = workspace_root;
  true
}

#[tauri::command]
pub fn workspace_bootstrap(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  window_label: String,
) -> Result<WorkspaceBootstrapPayload, String> {
  let (window_id, snapshot, changed) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let revision_before = model.revision;
    let window_id = model.ensure_window_exists_for_label(&window_label);
    let snapshot = model.snapshot();
    let changed = model.revision != revision_before;
    (window_id, snapshot, changed)
  };

  if changed {
    publish_snapshot(&app_handle, &snapshot, false);
  }

  Ok(WorkspaceBootstrapPayload {
    window_id,
    window_label,
    snapshot,
  })
}

#[tauri::command]
pub fn workspace_get_snapshot(state: State<WorkspaceState>) -> Result<WorkspaceSnapshot, String> {
  let model = state
    .inner
    .lock()
    .map_err(|_| "Workspace state is unavailable.".to_string())?;
  Ok(model.snapshot())
}

#[tauri::command]
pub fn workspace_new_window(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  options: Option<NewWindowOptions>,
) -> Result<WorkspaceWindowCreationPayload, String> {
  let (window_id, label, bounds, snapshot) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;

    let window_id = model.next_window_id();
    let label = format!("ws-{}", window_id.trim_start_matches("window-"));
    let bounds = WindowBounds {
      x: options.as_ref().and_then(|opt| opt.x).unwrap_or(120),
      y: options.as_ref().and_then(|opt| opt.y).unwrap_or(120),
      ..WindowBounds::default()
    };
    model.create_window_with_new_tab(window_id.clone(), label.clone(), bounds.clone());
    model.bump_revision();
    let snapshot = model.snapshot();
    (window_id, label, bounds, snapshot)
  };

  publish_snapshot(&app_handle, &snapshot, false);

  Ok(WorkspaceWindowCreationPayload {
    window_id,
    window_label: label,
    bounds,
    snapshot,
  })
}

#[tauri::command]
pub fn workspace_new_tab(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  window_id: String,
) -> Result<WorkspaceSnapshot, String> {
  let snapshot = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;

    if !model.windows.contains_key(&window_id) {
      return Err("Window not found.".to_string());
    }

    let tab = model.create_default_tab();
    let tab_id = tab.tab_id.clone();
    model.tabs.insert(tab_id.clone(), tab);
    let window = model
      .windows
      .get_mut(&window_id)
      .ok_or_else(|| "Window not found.".to_string())?;
    window.tab_order.push(tab_id.clone());
    window.active_tab_id = tab_id;
    model.bump_revision();
    model.snapshot()
  };

  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_set_active_tab(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  window_id: String,
  tab_id: String,
) -> Result<WorkspaceSnapshot, String> {
  let snapshot = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let window = model
      .windows
      .get_mut(&window_id)
      .ok_or_else(|| "Window not found.".to_string())?;
    if !window
      .tab_order
      .iter()
      .any(|existing_tab_id| existing_tab_id == &tab_id)
    {
      return Err("Tab not found in target window.".to_string());
    }
    if window.active_tab_id != tab_id {
      window.active_tab_id = tab_id;
      model.bump_revision();
    }
    model.snapshot()
  };
  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_set_tab_panel_type(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  terminal_state: State<TerminalState>,
  payload: TabPanelTypePayload,
) -> Result<WorkspaceSnapshot, String> {
  let (snapshot, terminal_session_to_stop) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let tab = model
      .tabs
      .get_mut(&payload.tab_id)
      .ok_or_else(|| "Tab not found.".to_string())?;
    let target_pane = select_tab_pane_mut(tab, &payload.pane)?;
    let update_result = update_pane_panel_type(target_pane, payload.panel_type);
    if update_result.changed {
      model.bump_revision();
    }
    (model.snapshot(), update_result.terminal_session_to_stop)
  };

  if let Some(session_id) = terminal_session_to_stop {
    let _ = stop_terminal_session_by_id(&terminal_state, &session_id);
  }

  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_set_tab_terminal_cwd(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabCwdPayload,
) -> Result<WorkspaceSnapshot, String> {
  let snapshot = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let tab = model
      .tabs
      .get_mut(&payload.tab_id)
      .ok_or_else(|| "Tab not found.".to_string())?;
    if tab.terminal_cwd_hint != payload.cwd_hint {
      tab.terminal_cwd_hint = payload.cwd_hint;
      model.bump_revision();
    }
    model.snapshot()
  };
  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_set_tab_pane_filesystem_state(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabPaneFilesystemStatePayload,
) -> Result<WorkspaceSnapshot, String> {
  let snapshot = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let tab = model
      .tabs
      .get_mut(&payload.tab_id)
      .ok_or_else(|| "Tab not found.".to_string())?;
    let target_pane = select_tab_pane_mut(tab, &payload.pane)?;

    if update_pane_filesystem_state(target_pane, payload.filesystem_state) {
      model.bump_revision();
    }
    model.snapshot()
  };
  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_set_tab_selected_files(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabSelectedFilesPayload,
) -> Result<WorkspaceSnapshot, String> {
  let snapshot = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let tab = model
      .tabs
      .get_mut(&payload.tab_id)
      .ok_or_else(|| "Tab not found.".to_string())?;

    if update_tab_selected_files(tab, payload.selected_files) {
      model.bump_revision();
    }
    model.snapshot()
  };
  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_set_tab_workspace_root(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabWorkspaceRootPayload,
) -> Result<WorkspaceSnapshot, String> {
  let snapshot = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let tab = model
      .tabs
      .get_mut(&payload.tab_id)
      .ok_or_else(|| "Tab not found.".to_string())?;
    if update_tab_workspace_root(tab, payload.workspace_root) {
      model.bump_revision();
    }
    model.snapshot()
  };
  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_set_window_bounds(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  window_id: String,
  bounds: WindowBounds,
) -> Result<(), String> {
  let snapshot = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;

    let window = model
      .windows
      .get_mut(&window_id)
      .ok_or_else(|| "Window not found.".to_string())?;
    if window.bounds.x != bounds.x
      || window.bounds.y != bounds.y
      || window.bounds.width != bounds.width
      || window.bounds.height != bounds.height
    {
      window.bounds = bounds;
      model.bump_revision();
      Some(model.snapshot())
    } else {
      None
    }
  };

  if let Some(snapshot) = snapshot {
    emit_workspace_updated(&app_handle, snapshot);
  }

  Ok(())
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
