use super::super::model::WorkspaceState;
use super::super::runtime_effects::{emit_workspace_updated, publish_snapshot};
use super::super::types::{
  NewWindowOptions, TabActivePanePayload, TabClosePanePayload, TabCwdPayload,
  TabOpenWorkspaceFolderPayload,
  TabLayoutSplitRatioPayload, TabPaneFilesystemStatePayload, TabPanelTypePayload,
  TabSelectedFilesPayload, TabSplitPanePayload, TabWorkspaceRootPayload, WindowBounds,
  WorkspaceBootstrapPayload, WorkspacePaneSplitPayload, WorkspaceSnapshot,
  WorkspaceWindowCreationPayload,
};
use super::basic_support::{
  close_layout_leaf, count_layout_leaves, find_first_layout_pane_id, layout_contains_pane,
  select_tab_pane, select_tab_pane_mut, split_layout_leaf, update_layout_split_ratio,
  update_pane_filesystem_state, update_pane_panel_type, update_tab_selected_files,
  update_tab_workspace_root,
};
use crate::commands::terminal::{stop_terminal_session_by_id, TerminalState};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, State};

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
    let target_pane = select_tab_pane_mut(tab, &payload.pane_id)?;
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
    let target_pane = select_tab_pane_mut(tab, &payload.pane_id)?;

    if update_pane_filesystem_state(target_pane, payload.filesystem_state) {
      model.bump_revision();
    }
    model.snapshot()
  };
  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_set_tab_active_pane(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabActivePanePayload,
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
    if !layout_contains_pane(&tab.layout, &payload.pane_id) {
      return Err("Pane not found.".to_string());
    }
    if tab.active_pane_id != payload.pane_id {
      tab.active_pane_id = payload.pane_id;
      model.bump_revision();
    }
    model.snapshot()
  };
  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_set_tab_layout_split_ratio(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabLayoutSplitRatioPayload,
) -> Result<WorkspaceSnapshot, String> {
  let (snapshot, changed) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let tab = model
      .tabs
      .get_mut(&payload.tab_id)
      .ok_or_else(|| "Tab not found.".to_string())?;

    let changed = update_layout_split_ratio(&mut tab.layout, &payload.split_path, payload.ratio)?;
    if changed {
      model.bump_revision();
    }
    (model.snapshot(), changed)
  };

  if changed {
    publish_snapshot(&app_handle, &snapshot, false);
  }
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_split_tab_pane(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabSplitPanePayload,
) -> Result<WorkspacePaneSplitPayload, String> {
  let (snapshot, new_pane_id) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let new_pane_id = model.next_pane_id();
    let new_terminal_session_id = model.next_terminal_session_id();
    let tab = model
      .tabs
      .get_mut(&payload.tab_id)
      .ok_or_else(|| "Tab not found.".to_string())?;
    if !layout_contains_pane(&tab.layout, &payload.pane_id) {
      return Err("Pane not found.".to_string());
    }
    let source_pane = select_tab_pane(tab, &payload.pane_id)?.clone();
    if !split_layout_leaf(
      &mut tab.layout,
      &payload.pane_id,
      payload.direction,
      &new_pane_id,
    ) {
      return Err("Pane not found.".to_string());
    }
    tab.pane_states.insert(
      new_pane_id.clone(),
      crate::commands::workspace::model::PaneState {
        pane_id: new_pane_id.clone(),
        panel_type: payload
          .new_panel_type
          .unwrap_or_else(|| source_pane.panel_type.clone()),
        terminal_session_id: new_terminal_session_id,
        filesystem_state: source_pane.filesystem_state,
      },
    );
    tab.active_pane_id = new_pane_id.clone();
    model.bump_revision();
    (model.snapshot(), new_pane_id)
  };

  publish_snapshot(&app_handle, &snapshot, false);
  Ok(WorkspacePaneSplitPayload {
    snapshot,
    new_pane_id,
  })
}

#[tauri::command]
pub fn workspace_close_tab_pane(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  terminal_state: State<TerminalState>,
  payload: TabClosePanePayload,
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
    if !layout_contains_pane(&tab.layout, &payload.pane_id) {
      return Err("Pane not found.".to_string());
    }
    if count_layout_leaves(&tab.layout) <= 1 {
      return Err("Cannot close the last pane.".to_string());
    }

    let next_active_pane_id = close_layout_leaf(&mut tab.layout, &payload.pane_id)?;
    let removed_pane = tab
      .pane_states
      .remove(&payload.pane_id)
      .ok_or_else(|| "Pane not found.".to_string())?;

    if tab.active_pane_id == payload.pane_id {
      tab.active_pane_id = next_active_pane_id
        .or_else(|| find_first_layout_pane_id(&tab.layout))
        .ok_or_else(|| "Pane not found.".to_string())?;
    }

    if !tab.pane_states.contains_key(&tab.active_pane_id) {
      tab.active_pane_id =
        find_first_layout_pane_id(&tab.layout).ok_or_else(|| "Pane not found.".to_string())?;
    }

    model.bump_revision();
    (model.snapshot(), Some(removed_pane.terminal_session_id))
  };

  if let Some(session_id) = terminal_session_to_stop {
    let _ = stop_terminal_session_by_id(&terminal_state, &session_id);
  }

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

fn infer_drive_from_path(path: &str) -> String {
  let normalized_path = path.trim();
  if normalized_path.is_empty() {
    return String::new();
  }

  #[cfg(target_os = "windows")]
  {
    use std::path::{Component, Prefix};

    let path_buf = PathBuf::from(normalized_path);
    let mut drive = String::new();

    for component in path_buf.components() {
      match component {
        Component::Prefix(prefix_component) => {
          drive = match prefix_component.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
              format!("{}:\\", char::from(letter).to_ascii_uppercase())
            }
            _ => prefix_component.as_os_str().to_string_lossy().to_string(),
          };
        }
        Component::RootDir => break,
        _ => break,
      }
    }

    return drive;
  }

  #[cfg(not(target_os = "windows"))]
  {
    if normalized_path.starts_with('/') {
      return "/".to_string();
    }
    return String::new();
  }
}

#[tauri::command]
pub fn workspace_open_workspace_folder_from_tab(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabOpenWorkspaceFolderPayload,
) -> Result<WorkspaceSnapshot, String> {
  let normalized_workspace_root = payload.workspace_root.trim().to_string();
  if normalized_workspace_root.is_empty() {
    return Err("Workspace folder path is required.".to_string());
  }

  let workspace_root_path = PathBuf::from(&normalized_workspace_root);
  if !workspace_root_path.is_dir() {
    return Err("Workspace folder does not exist.".to_string());
  }

  let snapshot = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;

    if !model.tabs.contains_key(&payload.tab_id) {
      return Err("Tab not found.".to_string());
    }

    let source_window_id = model
      .windows
      .iter()
      .find_map(|(window_id, window)| {
        window
          .tab_order
          .iter()
          .any(|tab_id| tab_id == &payload.tab_id)
          .then_some(window_id.clone())
      })
      .ok_or_else(|| "Window not found.".to_string())?;

    let mut new_tab = model.create_default_tab();
    let new_tab_id = new_tab.tab_id.clone();
    let active_pane_id = new_tab.active_pane_id.clone();
    new_tab.workspace_root = Some(normalized_workspace_root.clone());
    new_tab.terminal_cwd_hint = normalized_workspace_root.clone();

    if let Some(active_pane) = new_tab.pane_states.get_mut(&active_pane_id) {
      active_pane.filesystem_state.current_drive = infer_drive_from_path(&normalized_workspace_root);
      active_pane.filesystem_state.current_path = normalized_workspace_root.clone();
      active_pane.filesystem_state.selected_paths.clear();
      active_pane.filesystem_state.scroll_top = 0.0;
    }

    model.tabs.insert(new_tab_id.clone(), new_tab);
    let source_window = model
      .windows
      .get_mut(&source_window_id)
      .ok_or_else(|| "Window not found.".to_string())?;
    source_window.tab_order.push(new_tab_id.clone());
    source_window.active_tab_id = new_tab_id;
    model.bump_revision();
    model.snapshot()
  };

  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_read_folder_config(workspace_root: String) -> Result<Option<String>, String> {
  let trimmed_workspace_root = workspace_root.trim();
  if trimmed_workspace_root.is_empty() {
    return Ok(None);
  }

  let workspace_root_path = PathBuf::from(trimmed_workspace_root);
  if !workspace_root_path.is_dir() {
    return Ok(None);
  }

  let folder_config_path = workspace_root_path.join(".grayspace").join("folder.json");
  if !folder_config_path.is_file() {
    return Ok(None);
  }

  fs::read_to_string(&folder_config_path)
    .map(Some)
    .map_err(|error| error.to_string())
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
