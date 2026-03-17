use super::types::{
  WorkspaceSnapshot, WorkspaceUpdatedPayload, WORKSPACE_UPDATED_EVENT,
};
use crate::commands::terminal::{stop_terminal_session_by_id, TerminalState};
use tauri::{AppHandle, Emitter, Manager, State};

pub(super) fn emit_workspace_updated(app_handle: &AppHandle, snapshot: WorkspaceSnapshot) {
  let _ = app_handle.emit(
    WORKSPACE_UPDATED_EVENT,
    WorkspaceUpdatedPayload { snapshot },
  );
}

pub(super) fn stop_sessions(terminal_state: &State<TerminalState>, session_ids: &[String]) {
  for session_id in session_ids {
    let _ = stop_terminal_session_by_id(terminal_state, session_id);
  }
}

pub(super) fn close_runtime_window_by_label(app_handle: &AppHandle, maybe_label: Option<String>) {
  if let Some(label) = maybe_label {
    if let Some(window) = app_handle.get_webview_window(&label) {
      let _ = window.close();
    }
  }
}

pub(super) fn publish_snapshot(
  app_handle: &AppHandle,
  snapshot: &WorkspaceSnapshot,
  should_exit: bool,
) {
  emit_workspace_updated(app_handle, snapshot.clone());
  if should_exit {
    app_handle.exit(0);
  }
}
