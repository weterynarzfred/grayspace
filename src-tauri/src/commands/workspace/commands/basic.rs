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
use tauri::{AppHandle, State};

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

fn workspace_panels_config_path(workspace_root: &str) -> PathBuf {
  PathBuf::from(workspace_root)
    .join(".grayspace")
    .join("panels.json")
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

fn apply_filesystem_root_to_pane(pane: &mut PaneState, root_path: &str) {
  pane.filesystem_state.current_drive = infer_drive_from_path(root_path);
  pane.filesystem_state.current_path = root_path.to_string();
  pane.filesystem_state.selected_paths.clear();
  pane.filesystem_state.expanded_paths.clear();
  pane.filesystem_state.scroll_top = 0.0;
}

fn set_tab_filesystem_root(tab: &mut WorkspaceTab, root_path: &str) {
  let mut has_filesystem_pane = false;
  tab.pane_states.values_mut().for_each(|pane| {
    if pane.panel_type != "Filesystem" {
      return;
    }
    apply_filesystem_root_to_pane(pane, root_path);
    has_filesystem_pane = true;
  });

  if has_filesystem_pane {
    return;
  }

  let active_pane_id = tab.active_pane_id.clone();
  if let Some(active_pane) = tab.pane_states.get_mut(&active_pane_id) {
    apply_filesystem_root_to_pane(active_pane, root_path);
  }
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
  let preserved_filesystem_state = tab
    .pane_states
    .get(&tab.active_pane_id)
    .map(|pane_state| pane_state.filesystem_state.clone())
    .unwrap_or_default();

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
    let tab = model
      .tabs
      .get_mut(&payload.tab_id)
      .ok_or_else(|| "Tab not found.".to_string())?;
    let target_pane = select_tab_pane_mut(tab, &payload.pane_id)?;

    if update_pane_filesystem_state(target_pane, payload.filesystem_state) {
      model.bump_revision();
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
  Ok(snapshot)
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
mod tests {
  use super::{
    apply_tab_workspace_root_change, find_workspace_root_for_path, reset_tab_layout_to_default,
    set_tab_filesystem_root,
  };
  use crate::commands::workspace::commands::basic_support::split_layout_leaf;
  use crate::commands::workspace::model::WorkspaceModel;
  use crate::commands::workspace::types::{
    LayoutAxis, SplitDirection, TabLayoutNode, DEFAULT_SPLIT_RATIO,
  };
  use std::collections::BTreeSet;
  use std::path::PathBuf;
  use std::time::{SystemTime, UNIX_EPOCH};
  use std::{env, fs};

  fn unique_test_root(prefix: &str) -> PathBuf {
    let timestamp = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("clock should be monotonic")
      .as_nanos();
    env::temp_dir().join(format!("{prefix}-{timestamp}"))
  }

  #[test]
  fn reset_tab_layout_to_default_recreates_standard_split() {
    let mut model = WorkspaceModel::default();
    let mut tab = model.create_default_tab();
    let source_pane_id = tab.active_pane_id.clone();
    let extra_pane_id = "pane-extra".to_string();
    assert!(split_layout_leaf(
      &mut tab.layout,
      &source_pane_id,
      SplitDirection::Bottom,
      &extra_pane_id,
    ));

    let extra_terminal_session_id = "term-old-extra".to_string();
    let extra_pane = tab
      .pane_states
      .get(&source_pane_id)
      .expect("source pane should exist")
      .clone();
    tab.pane_states.insert(
      extra_pane_id.clone(),
      crate::commands::workspace::model::PaneState {
        pane_id: extra_pane_id.clone(),
        panel_type: "Terminal".to_string(),
        terminal_session_id: extra_terminal_session_id.clone(),
        filesystem_state: extra_pane.filesystem_state,
      },
    );
    tab.active_pane_id = extra_pane_id.clone();
    if let Some(active_pane) = tab.pane_states.get_mut(&extra_pane_id) {
      active_pane.filesystem_state.current_drive = "C:\\".to_string();
      active_pane.filesystem_state.current_path = "C:\\Outside".to_string();
    }

    let old_session_ids = reset_tab_layout_to_default(
      &mut tab,
      "term-new-left".to_string(),
      "term-new-right".to_string(),
    );
    let old_session_id_set = old_session_ids.into_iter().collect::<BTreeSet<_>>();
    assert_eq!(old_session_id_set.len(), 3);
    assert!(old_session_id_set.contains(&extra_terminal_session_id));

    let expected_left_pane_id = format!("{}-left", tab.tab_id);
    let expected_right_pane_id = format!("{}-right", tab.tab_id);
    assert_eq!(tab.active_pane_id, expected_left_pane_id);
    assert_eq!(
      tab.pane_states.keys().cloned().collect::<BTreeSet<_>>(),
      [expected_left_pane_id.clone(), expected_right_pane_id.clone()]
        .into_iter()
        .collect()
    );

    match &tab.layout {
      TabLayoutNode::Split {
        axis,
        ratio,
        first,
        second,
      } => {
        assert_eq!(*axis, LayoutAxis::Row);
        assert_eq!(*ratio, DEFAULT_SPLIT_RATIO);
        match first.as_ref() {
          TabLayoutNode::Leaf { pane_id } => assert_eq!(pane_id, &expected_left_pane_id),
          _ => panic!("left branch should be a leaf"),
        }
        match second.as_ref() {
          TabLayoutNode::Leaf { pane_id } => assert_eq!(pane_id, &expected_right_pane_id),
          _ => panic!("right branch should be a leaf"),
        }
      }
      _ => panic!("default layout should be split"),
    }

    let left_pane = tab
      .pane_states
      .get(&expected_left_pane_id)
      .expect("left pane should exist");
    let right_pane = tab
      .pane_states
      .get(&expected_right_pane_id)
      .expect("right pane should exist");
    assert_eq!(left_pane.panel_type, "Filesystem");
    assert_eq!(left_pane.filesystem_state.current_path, "C:\\Outside");
    assert_eq!(right_pane.panel_type, "Preview");
  }

  #[test]
  fn apply_tab_workspace_root_change_resets_layout_when_workspace_is_cleared() {
    let mut model = WorkspaceModel::default();
    let mut tab = model.create_default_tab();
    tab.workspace_root = Some("C:\\workspace".to_string());

    let source_pane_id = tab.active_pane_id.clone();
    let extra_pane_id = "pane-extra".to_string();
    assert!(split_layout_leaf(
      &mut tab.layout,
      &source_pane_id,
      SplitDirection::Bottom,
      &extra_pane_id,
    ));

    let extra_terminal_session_id = "term-old-extra".to_string();
    let extra_pane = tab
      .pane_states
      .get(&source_pane_id)
      .expect("source pane should exist")
      .clone();
    tab.pane_states.insert(
      extra_pane_id.clone(),
      crate::commands::workspace::model::PaneState {
        pane_id: extra_pane_id.clone(),
        panel_type: "Terminal".to_string(),
        terminal_session_id: extra_terminal_session_id.clone(),
        filesystem_state: extra_pane.filesystem_state,
      },
    );
    tab.active_pane_id = extra_pane_id.clone();
    if let Some(active_pane) = tab.pane_states.get_mut(&extra_pane_id) {
      active_pane.filesystem_state.current_drive = "C:\\".to_string();
      active_pane.filesystem_state.current_path = "C:\\Outside".to_string();
    }

    let tab_id = tab.tab_id.clone();
    model.tabs.insert(tab_id.clone(), tab);
    let (changed, old_session_ids) =
      apply_tab_workspace_root_change(&mut model, &tab_id, None).expect("update should succeed");
    assert!(changed);
    assert_eq!(old_session_ids.len(), 3);
    assert!(old_session_ids.contains(&extra_terminal_session_id));

    let updated_tab = model.tabs.get(&tab_id).expect("tab should exist");
    assert_eq!(updated_tab.workspace_root, None);

    let expected_left_pane_id = format!("{}-left", tab_id);
    let expected_right_pane_id = format!("{}-right", tab_id);
    assert_eq!(updated_tab.active_pane_id, expected_left_pane_id);
    assert_eq!(
      updated_tab.pane_states.keys().cloned().collect::<BTreeSet<_>>(),
      [expected_left_pane_id.clone(), expected_right_pane_id.clone()]
        .into_iter()
        .collect()
    );

    match &updated_tab.layout {
      TabLayoutNode::Split {
        axis,
        ratio,
        first,
        second,
      } => {
        assert_eq!(*axis, LayoutAxis::Row);
        assert_eq!(*ratio, DEFAULT_SPLIT_RATIO);
        match first.as_ref() {
          TabLayoutNode::Leaf { pane_id } => assert_eq!(pane_id, &expected_left_pane_id),
          _ => panic!("left branch should be a leaf"),
        }
        match second.as_ref() {
          TabLayoutNode::Leaf { pane_id } => assert_eq!(pane_id, &expected_right_pane_id),
          _ => panic!("right branch should be a leaf"),
        }
      }
      _ => panic!("default layout should be split"),
    }

    let left_pane = updated_tab
      .pane_states
      .get(&expected_left_pane_id)
      .expect("left pane should exist");
    let right_pane = updated_tab
      .pane_states
      .get(&expected_right_pane_id)
      .expect("right pane should exist");
    assert_eq!(left_pane.panel_type, "Filesystem");
    assert_eq!(left_pane.filesystem_state.current_path, "C:\\Outside");
    assert_eq!(right_pane.panel_type, "Preview");
  }

  #[test]
  fn find_workspace_root_for_path_detects_nearest_ancestor_workspace() {
    let test_root = unique_test_root("workspace-ancestor-detect");
    let workspace_root = test_root.join("WorkspaceRoot");
    let nested_folder = workspace_root.join("a").join("b");
    fs::create_dir_all(&nested_folder).expect("nested folder should be created");
    fs::create_dir_all(workspace_root.join(".grayspace")).expect("workspace marker should exist");

    let detected_workspace_root = find_workspace_root_for_path(&nested_folder)
      .expect("workspace root should be detected");
    assert_eq!(
      PathBuf::from(detected_workspace_root),
      workspace_root
    );

    fs::remove_dir_all(&test_root).expect("test root should be removed");
  }

  #[test]
  fn find_workspace_root_for_path_returns_none_without_workspace_marker() {
    let test_root = unique_test_root("workspace-ancestor-missing");
    let nested_folder = test_root.join("x").join("y");
    fs::create_dir_all(&nested_folder).expect("nested folder should be created");

    let detected_workspace_root = find_workspace_root_for_path(&nested_folder);
    assert_eq!(detected_workspace_root, None);

    fs::remove_dir_all(&test_root).expect("test root should be removed");
  }

  #[test]
  fn set_tab_filesystem_root_updates_all_filesystem_panes() {
    let mut model = WorkspaceModel::default();
    let mut tab = model.create_default_tab();
    let left_pane_id = tab.active_pane_id.clone();
    let right_pane_id = tab
      .pane_states
      .keys()
      .find(|pane_id| *pane_id != &left_pane_id)
      .expect("right pane should exist")
      .clone();

    {
      let right_pane = tab
        .pane_states
        .get_mut(&right_pane_id)
        .expect("right pane should exist");
      right_pane.panel_type = "Filesystem".to_string();
      right_pane.filesystem_state.current_path = "C:\\OldRight".to_string();
    }
    {
      let left_pane = tab
        .pane_states
        .get_mut(&left_pane_id)
        .expect("left pane should exist");
      left_pane.filesystem_state.current_path = "C:\\OldLeft".to_string();
    }

    set_tab_filesystem_root(&mut tab, "C:\\Workspace\\Nested");

    let left_pane = tab
      .pane_states
      .get(&left_pane_id)
      .expect("left pane should exist");
    let right_pane = tab
      .pane_states
      .get(&right_pane_id)
      .expect("right pane should exist");
    assert_eq!(left_pane.filesystem_state.current_path, "C:\\Workspace\\Nested");
    assert_eq!(right_pane.filesystem_state.current_path, "C:\\Workspace\\Nested");
    assert_eq!(left_pane.filesystem_state.current_drive, "C:\\");
    assert_eq!(right_pane.filesystem_state.current_drive, "C:\\");
  }
}
