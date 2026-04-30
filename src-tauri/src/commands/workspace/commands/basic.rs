use super::super::model::{PaneState, WorkspaceModel, WorkspaceState, WorkspaceTab};
use super::super::runtime_effects::{emit_workspace_updated, publish_snapshot};
use super::super::types::{
  FilesystemPaneState, LayoutAxis, NewWindowOptions, TabActivePanePayload, TabClosePanePayload,
  TabCwdPayload, TabLayoutNode, TabLayoutSplitRatioPayload, TabOpenFolderPayload,
  TabOpenWorkspaceFolderPayload, TabPaneFilesystemStatePayload, TabPanelTypePayload,
  TabSelectedFilesPayload, TabSplitPanePayload, TabWorkspaceRootPayload, WindowBounds,
  WorkspaceBootstrapPayload, WorkspacePaneSplitPayload, WorkspaceSnapshot,
  WorkspaceWindowCreationPayload, DEFAULT_LEFT_PANEL_TYPE, DEFAULT_RIGHT_PANEL_TYPE,
  DEFAULT_SPLIT_RATIO,
};
use super::basic_support::{
  close_layout_leaf, count_layout_leaves, find_first_layout_pane_id, layout_contains_pane,
  select_tab_pane, select_tab_pane_mut, split_layout_leaf, update_layout_split_ratio,
  update_pane_filesystem_state, update_pane_panel_type, update_tab_selected_files,
  update_tab_workspace_root,
};
use crate::commands::terminal::{stop_terminal_session_by_id, TerminalState};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePanelsPaneConfig {
  panel_type: String,
  #[serde(default)]
  filesystem_state: FilesystemPaneState,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePanelsConfig {
  layout: TabLayoutNode,
  pane_states: BTreeMap<String, WorkspacePanelsPaneConfig>,
  #[serde(default)]
  active_pane_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFolderEntry {
  path: String,
  opened_at_ms: u64,
  #[serde(default)]
  is_workspace: bool,
}

const RECENT_FOLDERS_FILE_NAME: &str = "recent-folders.json";
const MAX_RECENT_FOLDERS: usize = 200;

fn workspace_panels_config_path(workspace_root: &str) -> PathBuf {
  PathBuf::from(workspace_root)
    .join(".grayspace")
    .join("panels.json")
}

fn recent_folders_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
  let app_data_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|error| error.to_string())?;
  fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
  Ok(app_data_dir.join(RECENT_FOLDERS_FILE_NAME))
}

fn normalize_recent_folder_path(path: &str) -> String {
  let normalized_path = path.trim();
  if normalized_path.is_empty() {
    return String::new();
  }

  let mut trimmed_path = normalized_path.to_string();
  while trimmed_path.ends_with('\\') || trimmed_path.ends_with('/') {
    #[cfg(target_os = "windows")]
    {
      let bytes = trimmed_path.as_bytes();
      if bytes.len() == 3 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/') {
        break;
      }
    }

    #[cfg(not(target_os = "windows"))]
    {
      if trimmed_path == "/" {
        break;
      }
    }

    trimmed_path.pop();
  }

  trimmed_path
}

fn recent_folder_dedupe_key(path: &str) -> String {
  let normalized_path = normalize_recent_folder_path(path);

  #[cfg(target_os = "windows")]
  {
    normalized_path.replace('/', "\\").to_lowercase()
  }

  #[cfg(not(target_os = "windows"))]
  {
    normalized_path
  }
}

fn read_recent_folders(app_handle: &AppHandle) -> Vec<RecentFolderEntry> {
  let recent_folders_path = match recent_folders_path(app_handle) {
    Ok(path) => path,
    Err(_) => return Vec::new(),
  };
  if !recent_folders_path.is_file() {
    return Vec::new();
  }

  let raw_recent_folders = match fs::read_to_string(recent_folders_path) {
    Ok(raw) => raw,
    Err(_) => return Vec::new(),
  };
  if raw_recent_folders.trim().is_empty() {
    return Vec::new();
  }

  serde_json::from_str::<Vec<RecentFolderEntry>>(&raw_recent_folders).unwrap_or_default()
}

fn sort_recent_folders(entries: &mut [RecentFolderEntry]) {
  entries.sort_by(|left, right| {
    right
      .opened_at_ms
      .cmp(&left.opened_at_ms)
      .then_with(|| left.path.cmp(&right.path))
  });
}

fn persist_recent_folders(app_handle: &AppHandle, entries: &[RecentFolderEntry]) -> Result<(), String> {
  let recent_folders_path = recent_folders_path(app_handle)?;
  let serialized_recent_folders = serde_json::to_string_pretty(entries)
    .map_err(|error| error.to_string())?;
  fs::write(recent_folders_path, serialized_recent_folders).map_err(|error| error.to_string())
}

fn current_unix_timestamp_ms() -> u64 {
  let now = SystemTime::now();
  now
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis() as u64
}

fn is_workspace_folder_path(path: &str) -> bool {
  if path.is_empty() {
    return false;
  }
  PathBuf::from(path).join(".grayspace").is_dir()
}

fn record_recent_folder_open(app_handle: &AppHandle, path: &str) -> Result<(), String> {
  let normalized_path = normalize_recent_folder_path(path);
  if normalized_path.is_empty() {
    return Ok(());
  }

  let dedupe_key = recent_folder_dedupe_key(&normalized_path);
  if dedupe_key.is_empty() {
    return Ok(());
  }

  let mut entries = read_recent_folders(app_handle)
    .into_iter()
    .filter(|entry| recent_folder_dedupe_key(&entry.path) != dedupe_key)
    .collect::<Vec<_>>();
  let is_workspace = is_workspace_folder_path(&normalized_path);
  entries.push(RecentFolderEntry {
    path: normalized_path,
    opened_at_ms: current_unix_timestamp_ms(),
    is_workspace,
  });
  sort_recent_folders(&mut entries);
  if entries.len() > MAX_RECENT_FOLDERS {
    entries.truncate(MAX_RECENT_FOLDERS);
  }
  persist_recent_folders(app_handle, &entries)
}

fn find_workspace_root_for_path(path: &Path) -> Option<String> {
  let mut current_path = Some(path);
  while let Some(candidate_path) = current_path {
    if candidate_path.join(".grayspace").is_dir() {
      return Some(candidate_path.to_string_lossy().to_string());
    }
    current_path = candidate_path.parent();
  }
  None
}

fn collect_layout_pane_ids(layout: &TabLayoutNode, pane_ids: &mut Vec<String>) {
  match layout {
    TabLayoutNode::Leaf { pane_id } => pane_ids.push(pane_id.clone()),
    TabLayoutNode::Split { first, second, .. } => {
      collect_layout_pane_ids(first, pane_ids);
      collect_layout_pane_ids(second, pane_ids);
    }
  }
}

fn normalize_panel_type(panel_type: &str) -> String {
  let trimmed_panel_type = panel_type.trim();
  if trimmed_panel_type.is_empty() {
    "Filesystem".to_string()
  } else {
    trimmed_panel_type.to_string()
  }
}

fn apply_workspace_panels_config(
  model: &mut WorkspaceModel,
  tab: &mut WorkspaceTab,
  config: WorkspacePanelsConfig,
) -> bool {
  let mut pane_ids = Vec::new();
  collect_layout_pane_ids(&config.layout, &mut pane_ids);
  if pane_ids.is_empty() {
    return false;
  }
  let unique_pane_id_count = pane_ids.iter().collect::<BTreeSet<_>>().len();
  if unique_pane_id_count != pane_ids.len() {
    return false;
  }

  let mut next_pane_states = BTreeMap::new();
  for pane_id in &pane_ids {
    let Some(configured_pane_state) = config.pane_states.get(pane_id) else {
      return false;
    };
    next_pane_states.insert(
      pane_id.clone(),
      PaneState {
        pane_id: pane_id.clone(),
        panel_type: normalize_panel_type(&configured_pane_state.panel_type),
        terminal_session_id: model.next_terminal_session_id(),
        filesystem_state: configured_pane_state.filesystem_state.clone(),
      },
    );
  }

  let next_active_pane_id = if pane_ids.iter().any(|pane_id| pane_id == &config.active_pane_id) {
    config.active_pane_id
  } else {
    pane_ids[0].clone()
  };

  tab.layout = config.layout;
  tab.pane_states = next_pane_states;
  tab.active_pane_id = next_active_pane_id;
  true
}

fn read_workspace_panels_config(workspace_root: &str) -> Option<WorkspacePanelsConfig> {
  let panels_config_path = workspace_panels_config_path(workspace_root);
  if !panels_config_path.is_file() {
    return None;
  }
  let raw_panels_config = fs::read_to_string(panels_config_path).ok()?;
  serde_json::from_str::<WorkspacePanelsConfig>(&raw_panels_config).ok()
}

fn persist_workspace_panels_config_for_tab(tab: &WorkspaceTab) {
  let Some(workspace_root) = tab.workspace_root.as_deref() else {
    return;
  };

  let pane_states = tab
    .pane_states
    .iter()
    .map(|(pane_id, pane_state)| {
      (
        pane_id.clone(),
        WorkspacePanelsPaneConfig {
          panel_type: pane_state.panel_type.clone(),
          filesystem_state: pane_state.filesystem_state.clone(),
        },
      )
    })
    .collect::<BTreeMap<_, _>>();
  let panels_config = WorkspacePanelsConfig {
    layout: tab.layout.clone(),
    pane_states,
    active_pane_id: tab.active_pane_id.clone(),
  };

  let panels_config_path = workspace_panels_config_path(workspace_root);
  let Some(config_directory) = panels_config_path.parent() else {
    return;
  };
  if fs::create_dir_all(config_directory).is_err() {
    return;
  }
  let Ok(serialized_panels_config) = serde_json::to_string_pretty(&panels_config) else {
    return;
  };
  let _ = fs::write(panels_config_path, serialized_panels_config);
}

fn should_persist_workspace_panels_for_filesystem_state_change(
  previous_state: &FilesystemPaneState,
  next_state: &FilesystemPaneState,
) -> bool {
  previous_state.current_drive != next_state.current_drive
    || previous_state.current_path != next_state.current_path
    || previous_state.expanded_paths != next_state.expanded_paths
    || previous_state.thumbnail_size_px != next_state.thumbnail_size_px
    || previous_state.view_type != next_state.view_type
}

fn apply_filesystem_root_to_pane(pane: &mut PaneState, root_path: &str) {
  pane.filesystem_state.current_drive = infer_drive_from_path(root_path);
  pane.filesystem_state.current_path = root_path.to_string();
  pane.filesystem_state.selected_paths.clear();
  pane.filesystem_state.expanded_paths.clear();
  pane.filesystem_state.scroll_top = 0.0;
}

fn resolve_primary_filesystem_pane_id(tab: &WorkspaceTab) -> Option<String> {
  let mut pane_ids_in_layout_order = Vec::new();
  collect_layout_pane_ids(&tab.layout, &mut pane_ids_in_layout_order);

  pane_ids_in_layout_order
    .into_iter()
    .find(|pane_id| {
      tab
        .pane_states
        .get(pane_id)
        .is_some_and(|pane| pane.panel_type == "Filesystem")
    })
    .or_else(|| {
      tab
        .pane_states
        .iter()
        .find(|(_, pane)| pane.panel_type == "Filesystem")
        .map(|(pane_id, _)| pane_id.clone())
    })
}

fn set_tab_filesystem_root(tab: &mut WorkspaceTab, root_path: &str) {
  if let Some(primary_filesystem_pane_id) = resolve_primary_filesystem_pane_id(tab) {
    if let Some(primary_filesystem_pane) = tab.pane_states.get_mut(&primary_filesystem_pane_id) {
      apply_filesystem_root_to_pane(primary_filesystem_pane, root_path);
    }
    return;
  }

  let active_pane_id = tab.active_pane_id.clone();
  if let Some(active_pane) = tab.pane_states.get_mut(&active_pane_id) {
    apply_filesystem_root_to_pane(active_pane, root_path);
  }
}

fn filesystem_state_has_path(filesystem_state: &FilesystemPaneState) -> bool {
  !filesystem_state.current_path.trim().is_empty()
}

fn resolve_first_filesystem_state(tab: &WorkspaceTab) -> Option<FilesystemPaneState> {
  tab
    .pane_states
    .values()
    .find(|pane_state| {
      pane_state.panel_type == "Filesystem"
        && filesystem_state_has_path(&pane_state.filesystem_state)
    })
    .or_else(|| tab.pane_states.values().find(|pane_state| pane_state.panel_type == "Filesystem"))
    .map(|pane_state| pane_state.filesystem_state.clone())
}

fn resolve_preserved_filesystem_state(tab: &WorkspaceTab) -> FilesystemPaneState {
  if let Some(active_pane_state) = tab.pane_states.get(&tab.active_pane_id) {
    if active_pane_state.panel_type == "Filesystem" {
      return active_pane_state.filesystem_state.clone();
    }
  }

  let active_pane_state = tab
    .pane_states
    .get(&tab.active_pane_id)
    .map(|pane_state| pane_state.filesystem_state.clone())
    .unwrap_or_default();
  if filesystem_state_has_path(&active_pane_state) {
    return active_pane_state;
  }

  if let Some(filesystem_state) = resolve_first_filesystem_state(tab) {
    return filesystem_state;
  }

  if tab.terminal_cwd_hint.trim().is_empty() {
    return active_pane_state;
  }

  let mut preserved_filesystem_state = active_pane_state;
  preserved_filesystem_state.current_path = tab.terminal_cwd_hint.clone();
  preserved_filesystem_state.current_drive = infer_drive_from_path(&tab.terminal_cwd_hint);
  preserved_filesystem_state
}

fn reset_tab_layout_to_default(
  tab: &mut WorkspaceTab,
  left_terminal_session_id: String,
  right_terminal_session_id: String,
) -> Vec<String> {
  let previous_terminal_session_ids = tab
    .pane_states
    .values()
    .map(|pane_state| pane_state.terminal_session_id.clone())
    .collect::<Vec<_>>();
  let preserved_filesystem_state = resolve_preserved_filesystem_state(tab);

  let left_pane_id = format!("{}-left", tab.tab_id);
  let right_pane_id = format!("{}-right", tab.tab_id);
  let mut pane_states = BTreeMap::new();
  pane_states.insert(
    left_pane_id.clone(),
    PaneState {
      pane_id: left_pane_id.clone(),
      panel_type: DEFAULT_LEFT_PANEL_TYPE.to_string(),
      terminal_session_id: left_terminal_session_id,
      filesystem_state: preserved_filesystem_state,
    },
  );
  pane_states.insert(
    right_pane_id.clone(),
    PaneState {
      pane_id: right_pane_id.clone(),
      panel_type: DEFAULT_RIGHT_PANEL_TYPE.to_string(),
      terminal_session_id: right_terminal_session_id,
      filesystem_state: FilesystemPaneState::default(),
    },
  );

  tab.layout = TabLayoutNode::Split {
    axis: LayoutAxis::Row,
    ratio: DEFAULT_SPLIT_RATIO,
    first: Box::new(TabLayoutNode::Leaf {
      pane_id: left_pane_id.clone(),
    }),
    second: Box::new(TabLayoutNode::Leaf {
      pane_id: right_pane_id,
    }),
  };
  tab.pane_states = pane_states;
  tab.active_pane_id = left_pane_id;

  previous_terminal_session_ids
}

fn apply_tab_workspace_root_change(
  model: &mut WorkspaceModel,
  tab_id: &str,
  workspace_root: Option<String>,
) -> Result<(bool, Vec<String>), String> {
  let should_reset_layout = {
    let tab = model
      .tabs
      .get(tab_id)
      .ok_or_else(|| "Tab not found.".to_string())?;
    tab.workspace_root.is_some() && workspace_root.is_none()
  };
  let next_left_terminal_session_id = should_reset_layout.then(|| model.next_terminal_session_id());
  let next_right_terminal_session_id = should_reset_layout.then(|| model.next_terminal_session_id());

  let tab = model
    .tabs
    .get_mut(tab_id)
    .ok_or_else(|| "Tab not found.".to_string())?;
  let changed = update_tab_workspace_root(tab, workspace_root);
  let terminal_sessions_to_stop = if changed && should_reset_layout {
    reset_tab_layout_to_default(
      tab,
      next_left_terminal_session_id.expect("left terminal id should be set"),
      next_right_terminal_session_id.expect("right terminal id should be set"),
    )
  } else {
    Vec::new()
  };

  Ok((changed, terminal_sessions_to_stop))
}

fn find_window_id_containing_tab(model: &WorkspaceModel, tab_id: &str) -> Option<String> {
  model.windows.iter().find_map(|(window_id, window)| {
    window
      .tab_order
      .iter()
      .any(|existing_tab_id| existing_tab_id == tab_id)
      .then_some(window_id.clone())
  })
}

fn create_tab_for_opened_folder(
  model: &mut WorkspaceModel,
  opened_path: &str,
  workspace_root: Option<String>,
) -> WorkspaceTab {
  let mut new_tab = model.create_default_tab();
  if let Some(workspace_root_path) = workspace_root.as_deref() {
    if let Some(panels_config) = read_workspace_panels_config(workspace_root_path) {
      let _ = apply_workspace_panels_config(model, &mut new_tab, panels_config);
    }
  }

  new_tab.workspace_root = workspace_root;
  new_tab.terminal_cwd_hint = opened_path.to_string();
  set_tab_filesystem_root(&mut new_tab, opened_path);
  new_tab
}

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
  terminal_state: State<TerminalState>,
  payload: TabPanelTypePayload,
) -> Result<WorkspaceSnapshot, String> {
  let (snapshot, terminal_session_to_stop) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let (changed, terminal_session_to_stop) = {
      let tab = model
        .tabs
        .get_mut(&payload.tab_id)
        .ok_or_else(|| "Tab not found.".to_string())?;
      let target_pane = select_tab_pane_mut(tab, &payload.pane_id)?;
      let update_result = update_pane_panel_type(target_pane, payload.panel_type);
      (update_result.changed, update_result.terminal_session_to_stop)
    };

    if changed {
      model.bump_revision();
      if let Some(tab) = model.tabs.get(&payload.tab_id) {
        persist_workspace_panels_config_for_tab(tab);
      }
    }
    (model.snapshot(), terminal_session_to_stop)
  };

  if let Some(session_id) = terminal_session_to_stop {
    let _ = stop_terminal_session_by_id(&terminal_state, &session_id);
  }

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
pub fn workspace_set_tab_pane_filesystem_state(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabPaneFilesystemStatePayload,
) -> Result<WorkspaceSnapshot, String> {
  let snapshot = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let (filesystem_state_changed, persist_workspace_panels) = {
      let tab = model
        .tabs
        .get_mut(&payload.tab_id)
        .ok_or_else(|| "Tab not found.".to_string())?;
      let workspace_has_root = tab.workspace_root.is_some();
      let target_pane = select_tab_pane_mut(tab, &payload.pane_id)?;
      let previous_filesystem_state = target_pane.filesystem_state.clone();
      let filesystem_state_changed = update_pane_filesystem_state(target_pane, payload.filesystem_state);
      let persist_workspace_panels = filesystem_state_changed
        && workspace_has_root
        && should_persist_workspace_panels_for_filesystem_state_change(
          &previous_filesystem_state,
          &target_pane.filesystem_state,
        );
      (filesystem_state_changed, persist_workspace_panels)
    };

    if filesystem_state_changed {
      model.bump_revision();
    }

    if persist_workspace_panels {
      if let Some(tab) = model.tabs.get(&payload.tab_id) {
        persist_workspace_panels_config_for_tab(tab);
      }
    }
    model.snapshot()
  };
  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_set_tab_active_pane(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabActivePanePayload,
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
    if !layout_contains_pane(&tab.layout, &payload.pane_id) {
      return Err("Pane not found.".to_string());
    }
    if tab.active_pane_id != payload.pane_id {
      tab.active_pane_id = payload.pane_id;
      model.bump_revision();
    }
    model.snapshot()
  };
  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_set_tab_layout_split_ratio(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabLayoutSplitRatioPayload,
) -> Result<WorkspaceSnapshot, String> {
  let (snapshot, changed) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let changed = {
      let tab = model
        .tabs
        .get_mut(&payload.tab_id)
        .ok_or_else(|| "Tab not found.".to_string())?;
      update_layout_split_ratio(&mut tab.layout, &payload.split_path, payload.ratio)?
    };

    if changed {
      model.bump_revision();
      if let Some(tab) = model.tabs.get(&payload.tab_id) {
        persist_workspace_panels_config_for_tab(tab);
      }
    }
    (model.snapshot(), changed)
  };

  if changed {
    publish_snapshot(&app_handle, &snapshot, false);
  }
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_split_tab_pane(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabSplitPanePayload,
) -> Result<WorkspacePaneSplitPayload, String> {
  let (snapshot, new_pane_id) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let new_pane_id = model.next_pane_id();
    let new_terminal_session_id = model.next_terminal_session_id();
    {
      let tab = model
        .tabs
        .get_mut(&payload.tab_id)
        .ok_or_else(|| "Tab not found.".to_string())?;
      if !layout_contains_pane(&tab.layout, &payload.pane_id) {
        return Err("Pane not found.".to_string());
      }
      let source_pane = select_tab_pane(tab, &payload.pane_id)?.clone();
      if !split_layout_leaf(
        &mut tab.layout,
        &payload.pane_id,
        payload.direction,
        &new_pane_id,
      ) {
        return Err("Pane not found.".to_string());
      }
      tab.pane_states.insert(
        new_pane_id.clone(),
        PaneState {
          pane_id: new_pane_id.clone(),
          panel_type: payload
            .new_panel_type
            .unwrap_or_else(|| source_pane.panel_type.clone()),
          terminal_session_id: new_terminal_session_id,
          filesystem_state: source_pane.filesystem_state,
        },
      );
      tab.active_pane_id = new_pane_id.clone();
    }

    model.bump_revision();
    if let Some(tab) = model.tabs.get(&payload.tab_id) {
      persist_workspace_panels_config_for_tab(tab);
    }
    (model.snapshot(), new_pane_id)
  };

  publish_snapshot(&app_handle, &snapshot, false);
  Ok(WorkspacePaneSplitPayload {
    snapshot,
    new_pane_id,
  })
}

#[tauri::command]
pub fn workspace_close_tab_pane(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  terminal_state: State<TerminalState>,
  payload: TabClosePanePayload,
) -> Result<WorkspaceSnapshot, String> {
  let (snapshot, terminal_session_to_stop) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let terminal_session_to_stop = {
      let tab = model
        .tabs
        .get_mut(&payload.tab_id)
        .ok_or_else(|| "Tab not found.".to_string())?;
      if !layout_contains_pane(&tab.layout, &payload.pane_id) {
        return Err("Pane not found.".to_string());
      }
      if count_layout_leaves(&tab.layout) <= 1 {
        return Err("Cannot close the last pane.".to_string());
      }

      let next_active_pane_id = close_layout_leaf(&mut tab.layout, &payload.pane_id)?;
      let removed_pane = tab
        .pane_states
        .remove(&payload.pane_id)
        .ok_or_else(|| "Pane not found.".to_string())?;

      if tab.active_pane_id == payload.pane_id {
        tab.active_pane_id = next_active_pane_id
          .or_else(|| find_first_layout_pane_id(&tab.layout))
          .ok_or_else(|| "Pane not found.".to_string())?;
      }

      if !tab.pane_states.contains_key(&tab.active_pane_id) {
        tab.active_pane_id =
          find_first_layout_pane_id(&tab.layout).ok_or_else(|| "Pane not found.".to_string())?;
      }

      removed_pane.terminal_session_id
    };

    model.bump_revision();
    if let Some(tab) = model.tabs.get(&payload.tab_id) {
      persist_workspace_panels_config_for_tab(tab);
    }
    (model.snapshot(), Some(terminal_session_to_stop))
  };

  if let Some(session_id) = terminal_session_to_stop {
    let _ = stop_terminal_session_by_id(&terminal_state, &session_id);
  }

  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_set_tab_selected_files(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabSelectedFilesPayload,
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

    if update_tab_selected_files(tab, payload.selected_files) {
      model.bump_revision();
    }
    model.snapshot()
  };
  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_set_tab_workspace_root(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  terminal_state: State<TerminalState>,
  payload: TabWorkspaceRootPayload,
) -> Result<WorkspaceSnapshot, String> {
  let (snapshot, terminal_sessions_to_stop) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;
    let (changed, terminal_sessions_to_stop) =
      apply_tab_workspace_root_change(&mut model, &payload.tab_id, payload.workspace_root)?;
    if changed {
      model.bump_revision();
    }
    (model.snapshot(), terminal_sessions_to_stop)
  };

  for session_id in terminal_sessions_to_stop {
    let _ = stop_terminal_session_by_id(&terminal_state, &session_id);
  }

  publish_snapshot(&app_handle, &snapshot, false);
  Ok(snapshot)
}

fn infer_drive_from_path(path: &str) -> String {
  let normalized_path = path.trim();
  if normalized_path.is_empty() {
    return String::new();
  }

  #[cfg(target_os = "windows")]
  {
    use std::path::{Component, Prefix};

    let path_buf = PathBuf::from(normalized_path);
    let mut drive = String::new();

    for component in path_buf.components() {
      match component {
        Component::Prefix(prefix_component) => {
          drive = match prefix_component.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
              format!("{}:\\", char::from(letter).to_ascii_uppercase())
            }
            _ => prefix_component.as_os_str().to_string_lossy().to_string(),
          };
        }
        Component::RootDir => break,
        _ => break,
      }
    }

    return drive;
  }

  #[cfg(not(target_os = "windows"))]
  {
    if normalized_path.starts_with('/') {
      return "/".to_string();
    }
    return String::new();
  }
}

#[tauri::command]
pub fn workspace_open_workspace_folder_from_tab(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabOpenWorkspaceFolderPayload,
) -> Result<WorkspaceSnapshot, String> {
  let normalized_workspace_root = payload.workspace_root.trim().to_string();
  if normalized_workspace_root.is_empty() {
    return Err("Workspace folder path is required.".to_string());
  }

  let workspace_root_path = PathBuf::from(&normalized_workspace_root);
  if !workspace_root_path.is_dir() {
    return Err("Workspace folder does not exist.".to_string());
  }

  let snapshot = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;

    if !model.tabs.contains_key(&payload.tab_id) {
      return Err("Tab not found.".to_string());
    }

    let source_window_id = find_window_id_containing_tab(&model, &payload.tab_id)
      .ok_or_else(|| "Window not found.".to_string())?;

    let new_tab = create_tab_for_opened_folder(
      &mut model,
      &normalized_workspace_root,
      Some(normalized_workspace_root.clone()),
    );
    let new_tab_id = new_tab.tab_id.clone();
    model.tabs.insert(new_tab_id.clone(), new_tab);
    let source_window = model
      .windows
      .get_mut(&source_window_id)
      .ok_or_else(|| "Window not found.".to_string())?;
    source_window.tab_order.push(new_tab_id.clone());
    source_window.active_tab_id = new_tab_id;
    model.bump_revision();
    model.snapshot()
  };

  publish_snapshot(&app_handle, &snapshot, false);
  let _ = record_recent_folder_open(&app_handle, &normalized_workspace_root);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_open_folder_from_tab(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  payload: TabOpenFolderPayload,
) -> Result<WorkspaceSnapshot, String> {
  let normalized_path = payload.path.trim().to_string();
  if normalized_path.is_empty() {
    return Err("Folder path is required.".to_string());
  }

  let opened_folder_path = PathBuf::from(&normalized_path);
  if !opened_folder_path.is_dir() {
    return Err("Folder does not exist.".to_string());
  }
  let workspace_root = find_workspace_root_for_path(&opened_folder_path);

  let snapshot = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;

    if !model.tabs.contains_key(&payload.tab_id) {
      return Err("Tab not found.".to_string());
    }

    let source_window_id = find_window_id_containing_tab(&model, &payload.tab_id)
      .ok_or_else(|| "Window not found.".to_string())?;

    let new_tab = create_tab_for_opened_folder(&mut model, &normalized_path, workspace_root);
    let new_tab_id = new_tab.tab_id.clone();
    model.tabs.insert(new_tab_id.clone(), new_tab);

    let source_window = model
      .windows
      .get_mut(&source_window_id)
      .ok_or_else(|| "Window not found.".to_string())?;
    source_window.tab_order.push(new_tab_id.clone());
    source_window.active_tab_id = new_tab_id;
    model.bump_revision();
    model.snapshot()
  };

  publish_snapshot(&app_handle, &snapshot, false);
  let _ = record_recent_folder_open(&app_handle, &normalized_path);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_replace_tab_folder(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  terminal_state: State<TerminalState>,
  payload: TabOpenFolderPayload,
) -> Result<WorkspaceSnapshot, String> {
  let normalized_path = normalize_recent_folder_path(&payload.path);
  if normalized_path.is_empty() {
    return Err("Folder path is required.".to_string());
  }

  let opened_folder_path = PathBuf::from(&normalized_path);
  if !opened_folder_path.is_dir() {
    return Err("Folder does not exist.".to_string());
  }
  let workspace_root = find_workspace_root_for_path(&opened_folder_path);

  let (snapshot, terminal_sessions_to_stop) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;

    if !model.tabs.contains_key(&payload.tab_id) {
      return Err("Tab not found.".to_string());
    }

    let replacement_tab = create_tab_for_opened_folder(&mut model, &normalized_path, workspace_root);

    let tab = model
      .tabs
      .get_mut(&payload.tab_id)
      .ok_or_else(|| "Tab not found.".to_string())?;
    let terminal_sessions_to_stop = tab
      .pane_states
      .values()
      .map(|pane_state| pane_state.terminal_session_id.clone())
      .collect::<Vec<_>>();

    tab.layout = replacement_tab.layout;
    tab.pane_states = replacement_tab.pane_states;
    tab.active_pane_id = replacement_tab.active_pane_id;
    tab.selected_files = replacement_tab.selected_files;
    tab.terminal_cwd_hint = replacement_tab.terminal_cwd_hint;
    tab.workspace_root = replacement_tab.workspace_root;

    model.bump_revision();
    (model.snapshot(), terminal_sessions_to_stop)
  };

  for session_id in terminal_sessions_to_stop {
    let _ = stop_terminal_session_by_id(&terminal_state, &session_id);
  }

  publish_snapshot(&app_handle, &snapshot, false);
  let _ = record_recent_folder_open(&app_handle, &normalized_path);
  Ok(snapshot)
}

#[tauri::command]
pub fn workspace_recent_folders_list(app_handle: AppHandle) -> Result<Vec<RecentFolderEntry>, String> {
  let mut entries = read_recent_folders(&app_handle)
    .into_iter()
    .filter_map(|entry| {
      let path = normalize_recent_folder_path(&entry.path);
      if path.is_empty() {
        return None;
      }
      Some(RecentFolderEntry {
        path,
        opened_at_ms: entry.opened_at_ms,
        is_workspace: entry.is_workspace,
      })
    })
    .collect::<Vec<_>>();
  sort_recent_folders(&mut entries);
  Ok(entries)
}

#[tauri::command]
pub fn workspace_recent_folders_record(app_handle: AppHandle, path: String) -> Result<(), String> {
  record_recent_folder_open(&app_handle, &path)
}

#[tauri::command]
pub fn workspace_recent_folders_remove(app_handle: AppHandle, path: String) -> Result<(), String> {
  let dedupe_key = recent_folder_dedupe_key(&path);
  if dedupe_key.is_empty() {
    return Ok(());
  }

  let mut entries = read_recent_folders(&app_handle)
    .into_iter()
    .filter(|entry| recent_folder_dedupe_key(&entry.path) != dedupe_key)
    .collect::<Vec<_>>();
  sort_recent_folders(&mut entries);
  if entries.len() > MAX_RECENT_FOLDERS {
    entries.truncate(MAX_RECENT_FOLDERS);
  }
  persist_recent_folders(&app_handle, &entries)
}

#[tauri::command]
pub fn workspace_read_folder_config(workspace_root: String) -> Result<Option<String>, String> {
  let trimmed_workspace_root = workspace_root.trim();
  if trimmed_workspace_root.is_empty() {
    return Ok(None);
  }

  let workspace_root_path = PathBuf::from(trimmed_workspace_root);
  if !workspace_root_path.is_dir() {
    return Ok(None);
  }

  let folder_config_path = workspace_root_path.join(".grayspace").join("folder.json");
  if !folder_config_path.is_file() {
    return Ok(None);
  }

  fs::read_to_string(&folder_config_path)
    .map(Some)
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn workspace_read_folder_stylesheet(
  workspace_root: String,
  stylesheet_path: String,
) -> Result<Option<String>, String> {
  let trimmed_workspace_root = workspace_root.trim();
  if trimmed_workspace_root.is_empty() {
    return Ok(None);
  }

  let workspace_root_path = PathBuf::from(trimmed_workspace_root);
  if !workspace_root_path.is_dir() {
    return Ok(None);
  }

  let trimmed_stylesheet_path = stylesheet_path.trim();
  if trimmed_stylesheet_path.is_empty() {
    return Ok(None);
  }

  let relative_stylesheet_path = PathBuf::from(trimmed_stylesheet_path);
  if relative_stylesheet_path.is_absolute() {
    return Err("Stylesheet path must be relative to workspace root.".to_string());
  }
  if relative_stylesheet_path.components().any(|component| {
    matches!(
      component,
      std::path::Component::ParentDir
        | std::path::Component::RootDir
        | std::path::Component::Prefix(_)
    )
  }) {
    return Err("Stylesheet path must stay inside workspace root.".to_string());
  }

  let mut stylesheet_candidates = vec![workspace_root_path.join(&relative_stylesheet_path)];
  let has_path_separator_suffix = trimmed_stylesheet_path.ends_with('/')
    || trimmed_stylesheet_path.ends_with('\\');
  if !has_path_separator_suffix && trimmed_stylesheet_path.to_ascii_lowercase().ends_with(".css") {
    let mut scss_relative_path = relative_stylesheet_path.clone();
    scss_relative_path.set_extension("scss");
    if scss_relative_path != relative_stylesheet_path {
      stylesheet_candidates.push(workspace_root_path.join(scss_relative_path));
    }
  }

  let canonical_workspace_root_path =
    fs::canonicalize(&workspace_root_path).map_err(|error| error.to_string())?;
  for candidate_path in stylesheet_candidates {
    if !candidate_path.is_file() {
      continue;
    }

    let canonical_candidate_path = fs::canonicalize(&candidate_path).map_err(|error| error.to_string())?;
    if !canonical_candidate_path.starts_with(&canonical_workspace_root_path) {
      return Err("Stylesheet path escapes workspace root.".to_string());
    }

    return fs::read_to_string(canonical_candidate_path)
      .map(Some)
      .map_err(|error| error.to_string());
  }

  Ok(None)
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

#[cfg(test)]
mod tests;
