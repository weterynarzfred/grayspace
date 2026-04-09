use super::{
  close_tab_in_model, close_window_in_model, detach_tab_to_new_window_in_model,
  handle_runtime_window_destroyed_in_model, move_tab_in_model,
};
use crate::commands::workspace::model::WorkspaceModel;
use crate::commands::workspace::types::{
  CloseTabPayload, DetachTabPayload, MoveTabPayload, WindowBounds,
};
use std::collections::BTreeSet;

fn create_window_with_single_tab(
  model: &mut WorkspaceModel,
  window_id: &str,
  label: &str,
) -> String {
  let tab = model.create_default_tab();
  let tab_id = tab.tab_id.clone();
  model.tabs.insert(tab_id.clone(), tab);
  model.create_window_with_existing_tab(
    window_id.to_string(),
    label.to_string(),
    WindowBounds::default(),
    tab_id.clone(),
  );
  tab_id
}

fn append_tab_to_window(model: &mut WorkspaceModel, window_id: &str) -> String {
  let tab = model.create_default_tab();
  let tab_id = tab.tab_id.clone();
  model.tabs.insert(tab_id.clone(), tab);
  let window = model
    .windows
    .get_mut(window_id)
    .expect("window should exist");
  window.tab_order.push(tab_id.clone());
  tab_id
}

#[test]
fn move_tab_between_windows_closes_source_when_empty() {
  let mut model = WorkspaceModel::default();
  let source_tab_id = create_window_with_single_tab(&mut model, "window-source", "source");
  let target_tab_id = create_window_with_single_tab(&mut model, "window-target", "target");

  let payload = MoveTabPayload {
    source_window_id: "window-source".to_string(),
    target_window_id: "window-target".to_string(),
    tab_id: source_tab_id.clone(),
    target_index: Some(0),
  };

  let (snapshot, maybe_closed_label, should_exit) =
    move_tab_in_model(&mut model, &payload).expect("move should succeed");

  assert_eq!(maybe_closed_label.as_deref(), Some("source"));
  assert!(!should_exit);
  assert!(!model.windows.contains_key("window-source"));

  let target_window = model
    .windows
    .get("window-target")
    .expect("target window should exist");
  assert_eq!(
    target_window.tab_order,
    vec![source_tab_id.clone(), target_tab_id]
  );
  assert_eq!(target_window.active_tab_id, source_tab_id);
  assert_eq!(snapshot.windows.len(), 1);
}

#[test]
fn move_tab_within_same_window_reorders_tabs_and_keeps_window() {
  let mut model = WorkspaceModel::default();
  let first_tab_id = create_window_with_single_tab(&mut model, "window-1", "ws-1");
  let second_tab_id = append_tab_to_window(&mut model, "window-1");

  {
    let window = model.windows.get_mut("window-1").expect("window should exist");
    window.active_tab_id = first_tab_id;
  }

  let payload = MoveTabPayload {
    source_window_id: "window-1".to_string(),
    target_window_id: "window-1".to_string(),
    tab_id: second_tab_id.clone(),
    target_index: Some(0),
  };

  let (_, maybe_closed_label, should_exit) =
    move_tab_in_model(&mut model, &payload).expect("move should succeed");

  assert_eq!(maybe_closed_label, None);
  assert!(!should_exit);
  let window = model.windows.get("window-1").expect("window should exist");
  assert_eq!(window.tab_order[0], second_tab_id);
  assert_eq!(window.active_tab_id, window.tab_order[0]);
}

#[test]
fn move_tab_errors_when_tab_not_in_source_window() {
  let mut model = WorkspaceModel::default();
  let tab_id = create_window_with_single_tab(&mut model, "window-1", "ws-1");
  create_window_with_single_tab(&mut model, "window-2", "ws-2");

  let payload = MoveTabPayload {
    source_window_id: "window-2".to_string(),
    target_window_id: "window-1".to_string(),
    tab_id,
    target_index: None,
  };

  let result = move_tab_in_model(&mut model, &payload);
  assert!(result.is_err());
  let error = result.err().expect("move should fail");
  assert_eq!(error, "Tab not found in source window.");
}

#[test]
fn detach_tab_creates_new_window_and_closes_empty_source_window() {
  let mut model = WorkspaceModel::default();
  let tab_id = create_window_with_single_tab(&mut model, "window-source", "ws-source");

  let payload = DetachTabPayload {
    source_window_id: "window-source".to_string(),
    tab_id: tab_id.clone(),
    x: Some(320),
    y: None,
  };

  let (_, new_window_id, new_window_label, bounds, maybe_closed_label, should_exit) =
    detach_tab_to_new_window_in_model(&mut model, &payload).expect("detach should succeed");

  assert_eq!(maybe_closed_label.as_deref(), Some("ws-source"));
  assert!(!should_exit);
  assert!(!model.windows.contains_key("window-source"));
  assert_eq!(new_window_label, "ws-1");
  assert_eq!(new_window_id, "window-1");
  assert_eq!(bounds.x, 320);
  assert_eq!(bounds.y, 160);

  let new_window = model
    .windows
    .get(&new_window_id)
    .expect("new window should exist");
  assert_eq!(new_window.tab_order, vec![tab_id.clone()]);
  assert_eq!(new_window.active_tab_id, tab_id);
}

#[test]
fn close_tab_collects_terminal_sessions_and_repairs_active_tab() {
  let mut model = WorkspaceModel::default();
  let first_tab_id = create_window_with_single_tab(&mut model, "window-1", "ws-1");
  let second_tab_id = append_tab_to_window(&mut model, "window-1");
  let expected_sessions = model
    .tabs
    .get(&first_tab_id)
    .expect("first tab should exist")
    .pane_states
    .values()
    .map(|pane_state| pane_state.terminal_session_id.clone())
    .collect::<BTreeSet<_>>();

  {
    let window = model.windows.get_mut("window-1").expect("window should exist");
    window.active_tab_id = first_tab_id.clone();
  }

  let payload = CloseTabPayload {
    window_id: "window-1".to_string(),
    tab_id: first_tab_id.clone(),
  };

  let (_, session_ids, maybe_closed_label, should_exit) =
    close_tab_in_model(&mut model, &payload).expect("close should succeed");

  assert_eq!(maybe_closed_label, None);
  assert!(!should_exit);
  assert!(!model.tabs.contains_key(&first_tab_id));
  assert_eq!(
    session_ids.into_iter().collect::<BTreeSet<_>>(),
    expected_sessions
  );

  let window = model.windows.get("window-1").expect("window should exist");
  assert_eq!(window.tab_order, vec![second_tab_id.clone()]);
  assert_eq!(window.active_tab_id, second_tab_id);
}

#[test]
fn close_tab_errors_when_target_window_does_not_contain_tab() {
  let mut model = WorkspaceModel::default();
  let tab_id = create_window_with_single_tab(&mut model, "window-1", "ws-1");
  create_window_with_single_tab(&mut model, "window-2", "ws-2");

  let payload = CloseTabPayload {
    window_id: "window-2".to_string(),
    tab_id,
  };

  let result = close_tab_in_model(&mut model, &payload);
  assert!(result.is_err());
  let error = result.err().expect("close should fail");
  assert_eq!(error, "Tab not found in target window.");
}

#[test]
fn close_window_removes_window_and_reports_terminal_sessions() {
  let mut model = WorkspaceModel::default();
  let tab_id = create_window_with_single_tab(&mut model, "window-1", "ws-1");
  let expected_sessions = model
    .tabs
    .get(&tab_id)
    .expect("tab should exist")
    .pane_states
    .values()
    .map(|pane_state| pane_state.terminal_session_id.clone())
    .collect::<BTreeSet<_>>();

  let (_, session_ids, maybe_closed_label, should_exit) =
    close_window_in_model(&mut model, "window-1").expect("close window should succeed");

  assert_eq!(maybe_closed_label.as_deref(), Some("ws-1"));
  assert!(should_exit);
  assert!(model.windows.is_empty());
  assert!(model.tabs.is_empty());
  assert_eq!(
    session_ids.into_iter().collect::<BTreeSet<_>>(),
    expected_sessions
  );
}

#[test]
fn handle_runtime_window_destroyed_helper_closes_known_window_and_ignores_unknown_label() {
  let mut model = WorkspaceModel::default();
  create_window_with_single_tab(&mut model, "window-1", "ws-1");

  let none_result = handle_runtime_window_destroyed_in_model(&mut model, "missing-label");
  assert!(none_result.is_none());

  let some_result =
    handle_runtime_window_destroyed_in_model(&mut model, "ws-1").expect("window should close");
  let (snapshot, session_ids, should_exit) = some_result;
  assert!(should_exit);
  assert!(model.windows.is_empty());
  assert!(model.tabs.is_empty());
  assert!(session_ids.len() >= 2);
  assert!(snapshot.windows.is_empty());
}
