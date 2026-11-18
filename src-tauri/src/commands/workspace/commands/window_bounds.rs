use super::super::model::WorkspaceState;
use super::super::runtime_effects::emit_workspace_updated;
use super::super::types::{WindowBounds, DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, PhysicalRect, State};

const WINDOW_BOUNDS_FILE_NAME: &str = "window-bounds.json";
const CASCADE_OFFSET: i32 = 32;
/// How far below a window's top edge the tab strip, which drags the window, can be grabbed.
const GRIP_OFFSET: i32 = 16;

/// Monitor work areas in physical pixels, plus the primary monitor that placement falls back to.
struct Screens {
  work_areas: Vec<PhysicalRect<i32, u32>>,
  primary_work_area: PhysicalRect<i32, u32>,
  primary_scale_factor: f64,
}

fn window_bounds_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
  let app_data_dir = app_handle
    .path()
    .app_data_dir()
    .map_err(|error| error.to_string())?;
  fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;
  Ok(app_data_dir.join(WINDOW_BOUNDS_FILE_NAME))
}

fn read_saved_window_bounds(path: &Path) -> Option<WindowBounds> {
  let raw = fs::read_to_string(path).ok()?;
  serde_json::from_str(&raw).ok()
}

fn write_saved_window_bounds(path: &Path, bounds: &WindowBounds) -> Result<(), String> {
  let serialized = serde_json::to_string_pretty(bounds).map_err(|error| error.to_string())?;
  fs::write(path, serialized).map_err(|error| error.to_string())
}

/// True when the top centre of the tab strip is on some monitor, so the window can be dragged.
fn is_on_screen(bounds: &WindowBounds, work_areas: &[PhysicalRect<i32, u32>]) -> bool {
  let grip_x = i64::from(bounds.x) + i64::from(bounds.width / 2);
  let grip_y = i64::from(bounds.y) + i64::from(GRIP_OFFSET);
  work_areas.iter().any(|area| {
    let left = i64::from(area.position.x);
    let top = i64::from(area.position.y);
    (left..left + i64::from(area.size.width)).contains(&grip_x)
      && (top..top + i64::from(area.size.height)).contains(&grip_y)
  })
}

/// The default size at the primary monitor's scale, shrunk to fit and centred in its work area.
fn default_window_bounds(screens: &Screens) -> WindowBounds {
  let area = &screens.primary_work_area;
  let scaled = |length: u32, available: u32| {
    ((f64::from(length) * screens.primary_scale_factor).round() as u32).min(available)
  };
  let width = scaled(DEFAULT_WINDOW_WIDTH, area.size.width);
  let height = scaled(DEFAULT_WINDOW_HEIGHT, area.size.height);
  WindowBounds {
    x: area.position.x + ((area.size.width - width) / 2) as i32,
    y: area.position.y + ((area.size.height - height) / 2) as i32,
    width,
    height,
    maximized: false,
  }
}

fn keep_on_screen(bounds: WindowBounds, screens: &Screens) -> WindowBounds {
  if is_on_screen(&bounds, &screens.work_areas) {
    return bounds;
  }
  WindowBounds {
    maximized: bounds.maximized,
    ..default_window_bounds(screens)
  }
}

fn cascaded_bounds(reference: &WindowBounds) -> WindowBounds {
  WindowBounds {
    x: reference.x + CASCADE_OFFSET,
    y: reference.y + CASCADE_OFFSET,
    ..reference.clone()
  }
}

/// Queries the OS, so it must not run while the workspace state is locked.
fn read_screens(app_handle: &AppHandle) -> Option<Screens> {
  let monitors = app_handle.available_monitors().ok()?;
  let primary = app_handle
    .primary_monitor()
    .ok()
    .flatten()
    .or_else(|| monitors.first().cloned())?;
  Some(Screens {
    work_areas: monitors.iter().map(|monitor| *monitor.work_area()).collect(),
    primary_work_area: *primary.work_area(),
    primary_scale_factor: primary.scale_factor(),
  })
}

/// The saved bounds, or the default on first launch, moved to the primary monitor when they
/// are on no monitor.
pub(super) fn startup_window_bounds(app_handle: &AppHandle) -> WindowBounds {
  let saved = window_bounds_path(app_handle)
    .ok()
    .and_then(|path| read_saved_window_bounds(&path));
  match (saved, read_screens(app_handle)) {
    (Some(saved), Some(screens)) => keep_on_screen(saved, &screens),
    (None, Some(screens)) => default_window_bounds(&screens),
    (saved, None) => saved.unwrap_or_default(),
  }
}

/// `reference` moved down and right, so the new window does not cover it exactly.
pub(super) fn cascaded_window_bounds(app_handle: &AppHandle, reference: &WindowBounds) -> WindowBounds {
  let bounds = cascaded_bounds(reference);
  match read_screens(app_handle) {
    Some(screens) => keep_on_screen(bounds, &screens),
    None => bounds,
  }
}

/// Saves the window's bounds for the next launch whenever its normal rect or maximized state
/// changes, so the most recently arranged window wins.
#[tauri::command]
pub fn workspace_set_window_bounds(
  app_handle: AppHandle,
  state: State<WorkspaceState>,
  window_id: String,
  bounds: WindowBounds,
  minimized: bool,
) -> Result<(), String> {
  let (snapshot, changed_saved_bounds) = {
    let mut model = state
      .inner
      .lock()
      .map_err(|_| "Workspace state is unavailable.".to_string())?;

    let window = model
      .windows
      .get_mut(&window_id)
      .ok_or_else(|| "Window not found.".to_string())?;
    let saved_before = window.saved_bounds();
    if !window.apply_bounds_report(bounds, minimized) {
      return Ok(());
    }
    let saved_after = window.saved_bounds();
    model.bump_revision();
    (model.snapshot(), (saved_after != saved_before).then_some(saved_after))
  };

  emit_workspace_updated(&app_handle, snapshot);
  // The model is already updated, and the bootstrap report must not fail over a file it can't write.
  if let Some(saved_bounds) = changed_saved_bounds {
    let _ = window_bounds_path(&app_handle).and_then(|path| write_saved_window_bounds(&path, &saved_bounds));
  }
  Ok(())
}

#[cfg(test)]
mod tests;
