use super::{FilesystemPaneState, TabLayoutNode};

#[test]
fn filesystem_pane_state_keeps_search_options_as_given_and_omits_them_when_unset() {
  let saved_without_options: FilesystemPaneState = serde_json::from_value(serde_json::json!({
    "currentDrive": "C:\\",
    "currentPath": "C:\\Workspace",
    "scrollTop": 0.0,
  }))
  .expect("older pane state should deserialize");
  assert_eq!(saved_without_options.search_options, None);
  let serialized = serde_json::to_value(&saved_without_options).expect("pane state should serialize");
  assert!(serialized.get("searchOptions").is_none());

  let search_options = serde_json::json!({
    "useRegex": true,
    "skipFolders": false,
    "skipFolderNames": ["node_modules"],
    "skipCacheDirTagged": true,
  });
  let state = FilesystemPaneState {
    search_options: Some(search_options.clone()),
    ..FilesystemPaneState::default()
  };
  let round_tripped: FilesystemPaneState =
    serde_json::from_value(serde_json::to_value(&state).expect("pane state should serialize"))
      .expect("pane state should deserialize");
  assert_eq!(round_tripped.search_options, Some(search_options));
}

#[test]
fn leaf_layout_serializes_with_camel_case_pane_id() {
  let payload = serde_json::to_value(TabLayoutNode::Leaf {
    pane_id: "pane-1".to_string(),
  })
  .expect("layout should serialize");

  assert_eq!(
    payload.get("kind").and_then(serde_json::Value::as_str),
    Some("leaf")
  );
  assert_eq!(
    payload.get("paneId").and_then(serde_json::Value::as_str),
    Some("pane-1")
  );
  assert!(payload.get("pane_id").is_none());
}
