use super::super::model::{PaneState, WorkspaceModel, WorkspaceTab};
use super::super::types::{FilesystemPaneState, TabLayoutNode};
use super::basic_support::collect_layout_pane_ids;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspacePanelsPaneConfig {
  panel_type: String,
  #[serde(default)]
  filesystem_state: FilesystemPaneState,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspacePanelsConfig {
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

pub(super) fn find_workspace_root_for_path(path: &Path) -> Option<String> {
  let mut current_path = Some(path);
  while let Some(candidate_path) = current_path {
    if candidate_path.join(".grayspace").is_dir() {
      return Some(candidate_path.to_string_lossy().to_string());
    }
    current_path = candidate_path.parent();
  }
  None
}

fn normalize_panel_type(panel_type: &str) -> String {
  let trimmed_panel_type = panel_type.trim();
  if trimmed_panel_type.is_empty() {
    "Filesystem".to_string()
  } else {
    trimmed_panel_type.to_string()
  }
}

pub(super) fn apply_workspace_panels_config(
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

pub(super) fn read_workspace_panels_config(workspace_root: &str) -> Option<WorkspacePanelsConfig> {
  let panels_config_path = workspace_panels_config_path(workspace_root);
  if !panels_config_path.is_file() {
    return None;
  }
  let raw_panels_config = fs::read_to_string(panels_config_path).ok()?;
  serde_json::from_str::<WorkspacePanelsConfig>(&raw_panels_config).ok()
}

pub(super) fn persist_workspace_panels_config_for_tab(tab: &WorkspaceTab) {
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

pub(super) fn should_persist_workspace_panels_for_filesystem_state_change(
  previous_state: &FilesystemPaneState,
  next_state: &FilesystemPaneState,
) -> bool {
  previous_state.current_drive != next_state.current_drive
    || previous_state.current_path != next_state.current_path
    || previous_state.expanded_paths != next_state.expanded_paths
    || previous_state.thumbnail_size_px != next_state.thumbnail_size_px
    || previous_state.view_type != next_state.view_type
    || previous_state.sort_key != next_state.sort_key
    || previous_state.sort_descending != next_state.sort_descending
    || previous_state.search_options != next_state.search_options
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

#[cfg(test)]
mod tests;
