use serde::{Deserialize, Serialize};

pub const WORKSPACE_UPDATED_EVENT: &str = "workspace-updated";
pub const DEFAULT_WINDOW_WIDTH: u32 = 1100;
pub const DEFAULT_WINDOW_HEIGHT: u32 = 780;
pub const DEFAULT_LEFT_PANEL_TYPE: &str = "Filesystem";
pub const DEFAULT_RIGHT_PANEL_TYPE: &str = "Preview";

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
  pub layout: TabLayout,
  pub pane_states: PaneStateGroup,
  pub terminal_cwd_hint: String,
  pub workspace_root: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneStateGroup {
  pub left: PaneStateDto,
  pub right: PaneStateDto,
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
  pub selected_path: String,
  pub scroll_top: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabLayout {
  pub kind: String,
  pub split: u8,
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
  pub pane: String,
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
  pub pane: String,
  pub filesystem_state: FilesystemPaneState,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabWorkspaceRootPayload {
  pub tab_id: String,
  pub workspace_root: Option<String>,
}

impl Default for FilesystemPaneState {
  fn default() -> Self {
    Self {
      current_drive: String::new(),
      current_path: String::new(),
      selected_path: String::new(),
      scroll_top: 0.0,
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
