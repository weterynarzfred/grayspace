use super::super::model::WorkspaceState;
use super::super::runtime_effects::{emit_workspace_updated, publish_snapshot};
use super::super::types::{
  NewWindowOptions, TabCwdPayload, TabPanelTypePayload, WindowBounds, WorkspaceBootstrapPayload,
  WorkspaceSnapshot, WorkspaceWindowCreationPayload,
};
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
  payload: TabPanelTypePayload,
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
    let target_pane = match payload.pane.as_str() {
      "left" => &mut tab.pane_states.left,
      "right" => &mut tab.pane_states.right,
      _ => return Err("Unsupported pane identifier.".to_string()),
    };
    if target_pane.panel_type != payload.panel_type {
      target_pane.panel_type = payload.panel_type;
      model.bump_revision();
    }
    model.snapshot()
  };
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
