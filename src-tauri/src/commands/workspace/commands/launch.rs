use super::super::model::{WorkspaceModel, WorkspaceState};
use super::super::runtime_effects::publish_snapshot;
use super::super::types::WindowBounds;
use super::basic::create_tab_for_opened_folder;
use super::recent_folders::record_recent_folder_open;
use super::workspace_config::find_workspace_root_for_path;
use std::mem;
use std::path::{self, Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// A folder to open, plus the file to select in it when grayspace was launched with a file.
#[derive(Clone, Debug, PartialEq)]
pub struct LaunchTarget {
  folder: String,
  selected_file: Option<String>,
}

#[derive(Default)]
pub struct LaunchState {
  pending_target: Mutex<Option<LaunchTarget>>,
  last_focused_window_label: Mutex<String>,
}

impl LaunchTarget {
  pub(super) fn folder(&self) -> &str {
    &self.folder
  }
}

impl LaunchState {
  pub fn new(pending_target: Option<LaunchTarget>) -> Self {
    Self {
      pending_target: Mutex::new(pending_target),
      ..Self::default()
    }
  }

  pub fn remember_focused_window(&self, label: &str) {
    if let Ok(mut last_focused) = self.last_focused_window_label.lock() {
      *last_focused = label.to_string();
    }
  }
}

fn clean_path_string(path: &Path) -> String {
  path.components().collect::<PathBuf>().to_string_lossy().to_string()
}

/// Uses the first argument that isn't a flag; relative paths resolve against `cwd`.
/// Paths that don't exist are ignored.
pub fn resolve_launch_target(args: impl IntoIterator<Item = String>, cwd: &Path) -> Option<LaunchTarget> {
  let arg = args.into_iter().find(|arg| !arg.starts_with('-'))?;
  let path = path::absolute(cwd.join(arg.trim_matches('"'))).ok()?;
  if path.is_dir() {
    return Some(LaunchTarget {
      folder: clean_path_string(&path),
      selected_file: None,
    });
  }
  if path.is_file() {
    return Some(LaunchTarget {
      folder: clean_path_string(path.parent()?),
      selected_file: Some(clean_path_string(&path)),
    });
  }
  None
}

/// Adds a tab for `target` to the window and activates it. `replace_tabs` drops the window's
/// existing tabs, used for the fresh default tab of the first window.
pub(super) fn open_launch_target_in_window(
  model: &mut WorkspaceModel,
  window_id: &str,
  target: &LaunchTarget,
  replace_tabs: bool,
) {
  let workspace_root = find_workspace_root_for_path(Path::new(&target.folder));
  let mut tab = create_tab_for_opened_folder(model, &target.folder, workspace_root);
  if let Some(selected_file) = &target.selected_file {
    tab.selected_files.selected_paths = vec![selected_file.clone()];
    tab
      .pane_states
      .values_mut()
      .filter(|pane| pane.filesystem_state.current_path == target.folder)
      .for_each(|pane| pane.filesystem_state.selected_paths = vec![selected_file.clone()]);
  }
  let tab_id = tab.tab_id.clone();
  model.tabs.insert(tab_id.clone(), tab);

  let Some(window) = model.windows.get_mut(window_id) else {
    return;
  };
  let replaced_tab_ids = if replace_tabs { mem::take(&mut window.tab_order) } else { Vec::new() };
  window.tab_order.push(tab_id.clone());
  window.active_tab_id = tab_id;
  for replaced_tab_id in replaced_tab_ids {
    model.tabs.remove(&replaced_tab_id);
  }
  model.bump_revision();
}

/// The launch path given to the first instance, consumed by the first window that bootstraps.
pub(super) fn take_pending_launch_target(app_handle: &AppHandle) -> Option<LaunchTarget> {
  app_handle.state::<LaunchState>().pending_target.lock().ok()?.take()
}

fn open_in_last_focused_window(app_handle: &AppHandle, target: &LaunchTarget) -> Option<()> {
  let last_focused_label = app_handle
    .state::<LaunchState>()
    .last_focused_window_label
    .lock()
    .ok()?
    .clone();
  let workspace_state = app_handle.state::<WorkspaceState>();
  let (window_label, snapshot) = {
    let mut model = workspace_state.inner.lock().ok()?;
    let window_id = model
      .window_ids_by_label
      .get(&last_focused_label)
      .or_else(|| model.windows.keys().next())?
      .clone();
    open_launch_target_in_window(&mut model, &window_id, target, false);
    (model.windows.get(&window_id)?.label.clone(), model.snapshot())
  };

  publish_snapshot(app_handle, &snapshot, false);
  let _ = record_recent_folder_open(app_handle, &target.folder);
  let window = app_handle.get_webview_window(&window_label)?;
  let _ = window.unminimize();
  let _ = window.set_focus();
  Some(())
}

fn open_new_window(app_handle: &AppHandle) -> Option<()> {
  let workspace_state = app_handle.state::<WorkspaceState>();
  let (label, bounds, snapshot) = {
    let mut model = workspace_state.inner.lock().ok()?;
    let window_id = model.next_window_id();
    let label = format!("ws-{}", window_id.trim_start_matches("window-"));
    let bounds = WindowBounds::default();
    model.create_window_with_new_tab(window_id, label.clone(), bounds.clone());
    model.bump_revision();
    (label, bounds, model.snapshot())
  };

  publish_snapshot(app_handle, &snapshot, false);
  // Same options as `ensureWorkspaceWindowCreated` in src/workspace/appRuntime.js.
  WebviewWindowBuilder::new(app_handle, &label, WebviewUrl::App("index.html".into()))
    .title("grayspace")
    .decorations(false)
    .shadow(false)
    .position(f64::from(bounds.x), f64::from(bounds.y))
    .inner_size(f64::from(bounds.width), f64::from(bounds.height))
    .build()
    .ok()?;
  Some(())
}

/// Called in the running instance when grayspace is launched again: a path opens as a new tab
/// in the last focused window, no path opens a new window.
pub fn handle_second_instance_launch(app_handle: &AppHandle, args: Vec<String>, cwd: String) {
  let target = resolve_launch_target(args.into_iter().skip(1), Path::new(&cwd));
  let app_handle = app_handle.clone();
  // Creating a webview window from inside the plugin's message handler can deadlock on Windows.
  thread::spawn(move || match target {
    Some(target) => open_in_last_focused_window(&app_handle, &target),
    None => open_new_window(&app_handle),
  });
}

#[cfg(test)]
mod tests;
