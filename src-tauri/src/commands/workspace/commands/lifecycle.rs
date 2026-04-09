use super::super::model::{WorkspaceModel, WorkspaceState};
use super::super::runtime_effects::{
  close_runtime_window_by_label, publish_snapshot, stop_sessions,
};
use super::super::types::{
  CloseTabPayload, DetachTabPayload, MoveTabPayload, WindowBounds, WorkspaceSnapshot,
  WorkspaceWindowCreationPayload,
};
use crate::commands::terminal::TerminalState;
use tauri::{AppHandle, State};

fn move_tab_in_model(
  model: &mut WorkspaceModel,
  payload: &MoveTabPayload,
) -> Result<(WorkspaceSnapshot, Option<String>, bool), String> {
  if !model.windows.contains_key(&payload.source_window_id) {
    return Err("Source window not found.".to_string());
  }
  if !model.windows.contains_key(&payload.target_window_id) {
    return Err("Target window not found.".to_string());
  }
  if !model.tabs.contains_key(&payload.tab_id) {
    return Err("Tab not found.".to_string());
  }

  let source_contains_tab = model
    .windows
    .get(&payload.source_window_id)
    .map(|window| {
      window
        .tab_order
        .iter()
        .any(|tab_id| tab_id == &payload.tab_id)
    })
    .unwrap_or(false);
  if !source_contains_tab {
    return Err("Tab not found in source window.".to_string());
  }

  let is_same_window = payload.source_window_id == payload.target_window_id;

  {
    let source_window = model
      .windows
      .get_mut(&payload.source_window_id)
      .ok_or_else(|| "Source window not found.".to_string())?;
    source_window
      .tab_order
      .retain(|tab_id| tab_id != &payload.tab_id);
  }

  let target_index = {
    let target_window = model
      .windows
      .get(&payload.target_window_id)
      .ok_or_else(|| "Target window not found.".to_string())?;
    payload
      .target_index
      .map(|index| index.min(target_window.tab_order.len()))
      .unwrap_or(target_window.tab_order.len())
  };

  {
    let target_window = model
      .windows
      .get_mut(&payload.target_window_id)
      .ok_or_else(|| "Target window not found.".to_string())?;
    target_window
      .tab_order
      .insert(target_index, payload.tab_id.clone());
    target_window.active_tab_id = payload.tab_id.clone();
  }

  let maybe_closed_label = if !is_same_window {
    model.close_window_if_empty_or_fix_active(&payload.source_window_id)
  } else {
    model.ensure_window_has_active_tab(&payload.source_window_id);
    None
  };

  model.bump_revision();
  let should_exit = model.windows.is_empty();
  let snapshot = model.snapshot();
  Ok((snapshot, maybe_closed_label, should_exit))
}

fn detach_tab_to_new_window_in_model(
  model: &mut WorkspaceModel,
  payload: &DetachTabPayload,
) -> Result<(WorkspaceSnapshot, String, String, WindowBounds, Option<String>, bool), String> {
  if !model.windows.contains_key(&payload.source_window_id) {
    return Err("Source window not found.".to_string());
  }
  if !model.tabs.contains_key(&payload.tab_id) {
    return Err("Tab not found.".to_string());
  }

  let source_contains_tab = model
    .windows
    .get(&payload.source_window_id)
    .map(|window| {
      window
        .tab_order
        .iter()
        .any(|tab_id| tab_id == &payload.tab_id)
    })
    .unwrap_or(false);
  if !source_contains_tab {
    return Err("Tab not found in source window.".to_string());
  }

  {
    let source_window = model
      .windows
      .get_mut(&payload.source_window_id)
      .ok_or_else(|| "Source window not found.".to_string())?;
    source_window
      .tab_order
      .retain(|tab_id| tab_id != &payload.tab_id);
  }

  let new_window_id = model.next_window_id();
  let new_window_label = format!("ws-{}", new_window_id.trim_start_matches("window-"));
  let new_window_bounds = WindowBounds {
    x: payload.x.unwrap_or(160),
    y: payload.y.unwrap_or(160),
    ..WindowBounds::default()
  };
  model.create_window_with_existing_tab(
    new_window_id.clone(),
    new_window_label.clone(),
    new_window_bounds.clone(),
    payload.tab_id.clone(),
  );

  let maybe_closed_label = model.close_window_if_empty_or_fix_active(&payload.source_window_id);

  model.bump_revision();
  let should_exit = model.windows.is_empty();
  let snapshot = model.snapshot();
  Ok((
    snapshot,
    new_window_id,
    new_window_label,
    new_window_bounds,
    maybe_closed_label,
    should_exit,
  ))
}

fn close_tab_in_model(
  model: &mut WorkspaceModel,
  payload: &CloseTabPayload,
) -> Result<(WorkspaceSnapshot, Vec<String>, Option<String>, bool), String> {
  if !model.windows.contains_key(&payload.window_id) {
    return Err("Window not found.".to_string());
  }

  let window_contains_tab = model
    .windows
    .get(&payload.window_id)
    .map(|window| {
      window
        .tab_order
        .iter()
        .any(|tab_id| tab_id == &payload.tab_id)
    })
    .unwrap_or(false);
  if !window_contains_tab {
    return Err("Tab not found in target window.".to_string());
  }

  let tab = model
    .tabs
    .remove(&payload.tab_id)
    .ok_or_else(|| "Tab not found.".to_string())?;
  let terminal_session_ids = tab
    .pane_states
    .values()
    .map(|pane_state| pane_state.terminal_session_id.clone())
    .collect::<Vec<_>>();

  {
    let window = model
      .windows
      .get_mut(&payload.window_id)
      .ok_or_else(|| "Window not found.".to_string())?;
    window.tab_order.retain(|tab_id| tab_id != &payload.tab_id);
  }

  let maybe_closed_label = model.close_window_if_empty_or_fix_active(&payload.window_id);

  model.bump_revision();
  let should_exit = model.windows.is_empty();
  let snapshot = model.snapshot();
  Ok((
    snapshot,
    terminal_session_ids,
    maybe_closed_label,
    should_exit,
  ))
}

fn close_window_in_model(
  model: &mut WorkspaceModel,
  window_id: &str,
) -> Result<(WorkspaceSnapshot, Vec<String>, Option<String>, bool), String> {
  let Some((closed_label, session_ids)) =
    model.close_window_and_collect_terminal_sessions(window_id)
  else {
    return Err("Window not found.".to_string());
  };

  let should_exit = model.windows.is_empty();
  let snapshot = model.snapshot();
  Ok((snapshot, session_ids, Some(closed_label), should_exit))
}

fn handle_runtime_window_destroyed_in_model(
  model: &mut WorkspaceModel,
  window_label: &str,
) -> Option<(WorkspaceSnapshot, Vec<String>, bool)> {
  let window_id = model.window_ids_by_label.get(window_label).cloned()?;
  let (_, session_ids) = model.close_window_and_collect_terminal_sessions(&window_id)?;
  let snapshot = model.snapshot();
  let should_exit = model.windows.is_empty();
  Some((snapshot, session_ids, should_exit))
}

#[tauri::command]
pub fn workspace_move_tab(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: MoveTabPayload,
) -> Result<WorkspaceSnapshot, String> {
  let (snapshot, maybe_closed_label, should_exit) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    move_tab_in_model(&mut model, &payload)?
  };

  close_runtime_window_by_label(&app_handle, maybe_closed_label);
  publish_snapshot(&app_handle, &snapshot, should_exit);

  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_detach_tab_to_new_window(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: DetachTabPayload,
) -> Result<WorkspaceWindowCreationPayload, String> {
  let (
    snapshot,
    new_window_id,
    new_window_label,
    new_window_bounds,
    maybe_closed_label,
    should_exit,
  ) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    detach_tab_to_new_window_in_model(&mut model, &payload)?
  };

  close_runtime_window_by_label(&app_handle, maybe_closed_label);
  publish_snapshot(&app_handle, &snapshot, should_exit);

  Ok(WorkspaceWindowCreationPayload {
    window_id: new_window_id,
    window_label: new_window_label,
    bounds: new_window_bounds,
    snapshot,
  })
}

#[tauri::command]
pub fn workspace_close_tab(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  terminal_state: State<TerminalState>,
  payload: CloseTabPayload,
) -> Result<WorkspaceSnapshot, String> {
  let (snapshot, terminal_session_ids, maybe_closed_label, should_exit) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    close_tab_in_model(&mut model, &payload)?
  };

  stop_sessions(&terminal_state, &terminal_session_ids);

  close_runtime_window_by_label(&app_handle, maybe_closed_label);
  publish_snapshot(&app_handle, &snapshot, should_exit);

  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_close_window(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  terminal_state: State<TerminalState>,
  window_id: String,
) -> Result<WorkspaceSnapshot, String> {
  let (snapshot, terminal_session_ids, maybe_closed_label, should_exit) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    close_window_in_model(&mut model, &window_id)?
  };

  stop_sessions(&terminal_state, &terminal_session_ids);

  close_runtime_window_by_label(&app_handle, maybe_closed_label);
  publish_snapshot(&app_handle, &snapshot, should_exit);

  Ok(snapshot)
}

pub fn handle_runtime_window_destroyed(
  app_handle: &AppHandle,
  state: &State<WorkspaceState>,
  terminal_state: &State<TerminalState>,
  window_label: &str,
) {
  let (snapshot, terminal_session_ids, should_exit) = {
    let mut model = match state.inner.lock() {
      Ok(model) => model,
      Err(_) => return,
    };
    let Some(next_state) = handle_runtime_window_destroyed_in_model(&mut model, window_label) else {
      return;
    };
    next_state
  };

  stop_sessions(terminal_state, &terminal_session_ids);
  publish_snapshot(app_handle, &snapshot, should_exit);
}

#[cfg(test)]
mod tests;
