use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardModifierState {
  shift_key: bool,
  ctrl_key: bool,
}

#[tauri::command]
pub fn keyboard_modifier_state() -> KeyboardModifierState {
  #[cfg(target_os = "windows")]
  {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_SHIFT};

    KeyboardModifierState {
      shift_key: unsafe { GetKeyState(VK_SHIFT as i32) } < 0,
      ctrl_key: unsafe { GetKeyState(VK_CONTROL as i32) } < 0,
    }
  }

  #[cfg(not(target_os = "windows"))]
  {
    KeyboardModifierState {
      shift_key: false,
      ctrl_key: false,
    }
  }
}

#[tauri::command]
pub fn start_external_drag(
  window: tauri::Window,
  paths: Vec<String>,
  _mode: Option<String>,
) -> Result<(), String> {
  let normalized_paths: Vec<PathBuf> = paths
    .into_iter()
    .filter_map(|path| (!path.is_empty()).then_some(PathBuf::from(path)))
    .collect();

  if normalized_paths.is_empty() {
    return Err("No paths were provided for drag.".to_string());
  }

  let mut drag_paths = Vec::with_capacity(normalized_paths.len());
  for path in normalized_paths {
    drag_paths.push(fs::canonicalize(path).map_err(|error| error.to_string())?);
  }

  let drag_item = drag::DragItem::Files(drag_paths);
  let preview_icon = drag::Image::Raw(include_bytes!("../../../icons/32x32.png").to_vec());
  let drag_options = drag::Options {
    mode: drag::DragMode::Copy,
    ..drag::Options::default()
  };
  drag::start_drag(
    #[cfg(target_os = "linux")]
    &window.gtk_window().map_err(|error| error.to_string())?,
    #[cfg(not(target_os = "linux"))]
    &window,
    drag_item,
    preview_icon,
    |_drag_result, _cursor_position| {},
    drag_options,
  )
  .map_err(|error| error.to_string())
}
