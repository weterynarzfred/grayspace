use super::super::model::{WorkspaceModel, WorkspaceState};
use super::super::runtime_effects::publish_snapshot;
use super::super::types::WindowBounds;
use super::basic::create_tab_for_opened_folder;
use super::recent_folders::record_recent_folder_open;
use super::window_bounds::{cascaded_window_bounds, startup_window_bounds};
use super::workspace_config::find_workspace_root_for_path;
use std::mem;
use std::path::{self, Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

const STARTUP_WINDOW_LABEL: &str = "main";

/// A folder to open, plus the file to select in it when grayspace was launched with a file.
#[derive(Clone, Debug, PartialEq)]
pub struct LaunchTarget {
  folder: String,
  selected_file: Option<String>,
}

#[derive(Default)]
pub struct LaunchState {
  last_focused_window_label: Mutex<String>,
}

impl LaunchState {
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

/// Falls back to any window when the last focused one is gone or none has been focused yet.
fn last_focused_window_id(app_handle: &AppHandle, model: &WorkspaceModel) -> Option<String> {
  let last_focused_label = app_handle
    .state::<LaunchState>()
    .last_focused_window_label
    .lock()
    .ok()?
    .clone();
  model
    .window_ids_by_label
    .get(&last_focused_label)
    .or_else(|| model.windows.keys().next())
    .cloned()
}

/// Built hidden and placed afterwards in physical pixels: the builder's logical position would
/// be scaled by the DPI of whichever monitor the window is first created on.
fn build_workspace_window(app_handle: &AppHandle, label: &str, bounds: &WindowBounds) -> Option<()> {
  // Same options as `ensureWorkspaceWindowCreated` in src/workspace/appRuntime.js.
  let window = WebviewWindowBuilder::new(app_handle, label, WebviewUrl::App("index.html".into()))
    .title("grayspace")
    .decorations(false)
    .shadow(false)
    .visible(false)
    .build()
    .ok()?;
  window.set_position(PhysicalPosition::new(bounds.x, bounds.y)).ok()?;
  // After the move, which rescales the window when it lands on a monitor with another DPI.
  window.set_size(PhysicalSize::new(bounds.width, bounds.height)).ok()?;
  // Maximizing a hidden window shows it already maximized, without a restore-to-maximize animation.
  if bounds.maximized {
    window.maximize().ok()?;
  }
  window.show().ok()
}

/// Creates the first window, showing the folder grayspace was launched with, if any.
pub fn open_startup_window(app_handle: &AppHandle, target: Option<LaunchTarget>) -> Option<()> {
  let bounds = startup_window_bounds(app_handle);
  let workspace_state = app_handle.state::<WorkspaceState>();
  {
    let mut model = workspace_state.inner.lock().ok()?;
    let window_id = model.next_window_id();
    model.create_window_with_new_tab(window_id.clone(), STARTUP_WINDOW_LABEL.to_string(), bounds.clone());
    model.bump_revision();
    if let Some(target) = &target {
      open_launch_target_in_window(&mut model, &window_id, target, true);
    }
  }

  if let Some(target) = &target {
    let _ = record_recent_folder_open(app_handle, &target.folder);
  }
  build_workspace_window(app_handle, STARTUP_WINDOW_LABEL, &bounds)
}

fn open_in_last_focused_window(app_handle: &AppHandle, target: &LaunchTarget) -> Option<()> {
  let workspace_state = app_handle.state::<WorkspaceState>();
  let (window_label, snapshot) = {
    let mut model = workspace_state.inner.lock().ok()?;
    let window_id = last_focused_window_id(app_handle, &model)?;
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

/// Opens a window with a fresh tab, cascaded from the last focused window. Callers must not be
/// synchronous commands or the single-instance handler: building a window there deadlocks on
/// Windows.
pub(super) fn open_new_window(app_handle: &AppHandle) -> Option<()> {
  let workspace_state = app_handle.state::<WorkspaceState>();
  let reference_bounds = {
    let model = workspace_state.inner.lock().ok()?;
    last_focused_window_id(app_handle, &model)
      .and_then(|window_id| model.windows.get(&window_id))
      .map(|window| window.saved_bounds())
  };
  // Placement queries the monitors, which must not happen while the model is locked.
  let bounds = match reference_bounds {
    Some(reference) => cascaded_window_bounds(app_handle, &reference),
    None => startup_window_bounds(app_handle),
  };
  let (label, snapshot) = {
    let mut model = workspace_state.inner.lock().ok()?;
    let window_id = model.next_window_id();
    let label = format!("ws-{}", window_id.trim_start_matches("window-"));
    model.create_window_with_new_tab(window_id, label.clone(), bounds.clone());
    model.bump_revision();
    (label, model.snapshot())
  };

  publish_snapshot(app_handle, &snapshot, false);
  build_workspace_window(app_handle, &label, &bounds)
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
