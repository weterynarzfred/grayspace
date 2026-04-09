use super::{for_each_session_id, publish_with_hooks, with_optional_label};

#[test]
fn for_each_session_id_invokes_callback_for_each_entry_in_order() {
  let session_ids = vec![
    "session-a".to_string(),
    "session-b".to_string(),
    "session-b".to_string(),
  ];
  let mut visited = Vec::new();

  for_each_session_id(&session_ids, |session_id| {
    visited.push(session_id.to_string());
  });

  assert_eq!(visited, session_ids);
}

#[test]
fn for_each_session_id_allows_empty_inputs() {
  let session_ids: Vec<String> = Vec::new();
  let mut call_count = 0;

  for_each_session_id(&session_ids, |_| {
    call_count += 1;
  });

  assert_eq!(call_count, 0);
}

#[test]
fn with_optional_label_invokes_callback_when_label_exists() {
  let mut visited = Vec::new();

  let called = with_optional_label(Some("workspace-main".to_string()), |label| {
    visited.push(label.to_string());
  });

  assert!(called);
  assert_eq!(visited, vec!["workspace-main".to_string()]);
}

#[test]
fn with_optional_label_skips_callback_when_label_is_missing() {
  let mut call_count = 0;

  let called = with_optional_label(None, |_| {
    call_count += 1;
  });

  assert!(!called);
  assert_eq!(call_count, 0);
}

#[test]
fn publish_with_hooks_emits_snapshot_without_exiting_when_flag_is_false() {
  let mut emit_calls = 0;
  let mut exit_codes = Vec::new();

  publish_with_hooks(
    false,
    || emit_calls += 1,
    |exit_code| exit_codes.push(exit_code),
  );

  assert_eq!(emit_calls, 1);
  assert!(exit_codes.is_empty());
}

#[test]
fn publish_with_hooks_exits_with_zero_when_flag_is_true() {
  let mut emit_calls = 0;
  let mut exit_codes = Vec::new();

  publish_with_hooks(
    true,
    || emit_calls += 1,
    |exit_code| exit_codes.push(exit_code),
  );

  assert_eq!(emit_calls, 1);
  assert_eq!(exit_codes, vec![0]);
}
