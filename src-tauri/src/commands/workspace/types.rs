use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const WORKSPACE_UPDATED_EVENT: &str = "workspace-updated";
pub const DEFAULT_WINDOW_WIDTH: u32 = 1100;
pub const DEFAULT_WINDOW_HEIGHT: u32 = 780;
pub const DEFAULT_LEFT_PANEL_TYPE: &str = "Filesystem";
pub const DEFAULT_RIGHT_PANEL_TYPE: &str = "Preview";
pub const DEFAULT_SPLIT_RATIO: u8 = 50;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceUpdatedPayload {
  pub snapshot: WorkspaceSnapshot,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBootstrapPayload {
  pub window_id: String,
  pub window_label: String,
  pub snapshot: WorkspaceSnapshot,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWindowCreationPayload {
  pub window_id: String,
  pub window_label: String,
  pub bounds: WindowBounds,
  pub snapshot: WorkspaceSnapshot,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePaneSplitPayload {
  pub snapshot: WorkspaceSnapshot,
  pub new_pane_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
  pub revision: u64,
  pub windows: Vec<WindowState>,
  pub tabs: Vec<TabState>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
  pub window_id: String,
  pub label: String,
  pub tab_order: Vec<String>,
  pub active_tab_id: String,
  pub bounds: WindowBounds,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabState {
  pub tab_id: String,
  pub title: String,
  pub layout: TabLayoutNode,
  pub pane_states: BTreeMap<String, PaneStateDto>,
  pub active_pane_id: String,
  pub selected_files: TabSelectedFilesState,
  pub terminal_cwd_hint: String,
  pub workspace_root: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum TabLayoutNode {
  Leaf {
    #[serde(rename = "paneId")]
    pane_id: String,
  },
  Split {
    axis: LayoutAxis,
    ratio: u8,
    first: Box<TabLayoutNode>,
    second: Box<TabLayoutNode>,
  },
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum LayoutAxis {
  Row,
  Column,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneStateDto {
  pub pane_id: String,
  pub panel_type: String,
  pub terminal_session_id: String,
  pub filesystem_state: FilesystemPaneState,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemPaneState {
  pub current_drive: String,
  pub current_path: String,
  #[serde(default)]
  pub selected_paths: Vec<String>,
  #[serde(default)]
  pub expanded_paths: Vec<String>,
  pub scroll_top: f64,
}

#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TabSelectedFilesState {
  #[serde(default)]
  pub selected_paths: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
  pub x: i32,
  pub y: i32,
  pub width: u32,
  pub height: u32,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewWindowOptions {
  pub x: Option<i32>,
  pub y: Option<i32>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveTabPayload {
  pub source_window_id: String,
  pub target_window_id: String,
  pub tab_id: String,
  pub target_index: Option<usize>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachTabPayload {
  pub source_window_id: String,
  pub tab_id: String,
  pub x: Option<i32>,
  pub y: Option<i32>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseTabPayload {
  pub window_id: String,
  pub tab_id: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabPanelTypePayload {
  pub tab_id: String,
  pub pane_id: String,
  pub panel_type: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabCwdPayload {
  pub tab_id: String,
  pub cwd_hint: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabPaneFilesystemStatePayload {
  pub tab_id: String,
  pub pane_id: String,
  pub filesystem_state: FilesystemPaneState,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabActivePanePayload {
  pub tab_id: String,
  pub pane_id: String,
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SplitDirection {
  Right,
  Bottom,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabSplitPanePayload {
  pub tab_id: String,
  pub pane_id: String,
  pub direction: SplitDirection,
  #[serde(default)]
  pub new_panel_type: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabClosePanePayload {
  pub tab_id: String,
  pub pane_id: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabLayoutSplitRatioPayload {
  pub tab_id: String,
  pub split_path: String,
  pub ratio: u8,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabSelectedFilesPayload {
  pub tab_id: String,
  pub selected_files: TabSelectedFilesState,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabWorkspaceRootPayload {
  pub tab_id: String,
  pub workspace_root: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabOpenWorkspaceFolderPayload {
  pub tab_id: String,
  pub workspace_root: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabOpenFolderPayload {
  pub tab_id: String,
  pub path: String,
}

impl Default for FilesystemPaneState {
  fn default() -> Self {
    Self {
      current_drive: String::new(),
      current_path: String::new(),
      selected_paths: Vec::new(),
      expanded_paths: Vec::new(),
      scroll_top: 0.0,
    }
  }
}

impl Default for TabSelectedFilesState {
  fn default() -> Self {
    Self {
      selected_paths: Vec::new(),
    }
  }
}

impl Default for WindowBounds {
  fn default() -> Self {
    Self {
      x: 80,
      y: 80,
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    }
  }
}

#[cfg(test)]
mod tests {
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
}
