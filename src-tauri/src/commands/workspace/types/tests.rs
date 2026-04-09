use super::TabLayoutNode;

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
