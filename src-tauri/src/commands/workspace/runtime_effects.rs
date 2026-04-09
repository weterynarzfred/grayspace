use super::types::{WorkspaceSnapshot, WorkspaceUpdatedPayload, WORKSPACE_UPDATED_EVENT};
use crate::commands::terminal::{stop_terminal_session_by_id, TerminalState};
use tauri::{AppHandle, Emitter, Manager, State};

fn for_each_session_id<F>(session_ids: &[String], mut callback: F)
where
  F: FnMut(&str),
{
  for session_id in session_ids {
    callback(session_id);
  }
}

fn with_optional_label<F>(maybe_label: Option<String>, mut callback: F) -> bool
where
  F: FnMut(&str),
{
  if let Some(label) = maybe_label {
    callback(&label);
    true
  } else {
    false
  }
}

fn publish_with_hooks<FE, FX>(should_exit: bool, mut emit_callback: FE, mut exit_callback: FX)
where
  FE: FnMut(),
  FX: FnMut(i32),
{
  emit_callback();
  if should_exit {
    exit_callback(0);
  }
}

pub(super) fn emit_workspace_updated(app_handle: &AppHandle, snapshot: WorkspaceSnapshot) {
  let _ = app_handle.emit(
    WORKSPACE_UPDATED_EVENT,
    WorkspaceUpdatedPayload { snapshot },
  );
}

pub(super) fn stop_sessions(terminal_state: &State<TerminalState>, session_ids: &[String]) {
  for_each_session_id(session_ids, |session_id| {
    let _ = stop_terminal_session_by_id(terminal_state, session_id);
  });
}

pub(super) fn close_runtime_window_by_label(app_handle: &AppHandle, maybe_label: Option<String>) {
  with_optional_label(maybe_label, |label| {
    if let Some(window) = app_handle.get_webview_window(&label) {
      let _ = window.close();
    }
  });
}

pub(super) fn publish_snapshot(
  app_handle: &AppHandle,
  snapshot: &WorkspaceSnapshot,
  should_exit: bool,
) {
  publish_with_hooks(
    should_exit,
    || emit_workspace_updated(app_handle, snapshot.clone()),
    |exit_code| app_handle.exit(exit_code),
  );
}

#[cfg(test)]
mod tests;
