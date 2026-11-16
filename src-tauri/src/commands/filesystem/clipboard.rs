use serde::Serialize;
use std::path::PathBuf;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemClipboardState {
  mode: String,
  paths: Vec<String>,
}

#[cfg(target_os = "windows")]
const CLIPBOARD_DROPEFFECT_COPY: u32 = 1;
#[cfg(target_os = "windows")]
const CLIPBOARD_DROPEFFECT_MOVE: u32 = 2;

#[cfg(target_os = "windows")]
fn utf16_null_terminated(value: &str) -> Vec<u16> {
  value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn with_open_clipboard<T>(operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
  use windows_sys::Win32::System::DataExchange::{CloseClipboard, OpenClipboard};

  unsafe {
    if OpenClipboard(std::ptr::null_mut()) == 0 {
      return Err("Failed to open clipboard.".to_string());
    }
  }

  let result = operation();

  unsafe {
    CloseClipboard();
  }

  result
}

#[cfg(target_os = "windows")]
fn encode_clipboard_file_list(paths: &[PathBuf]) -> Vec<u16> {
  use std::os::windows::ffi::OsStrExt;

  let mut encoded = Vec::new();
  for path in paths {
    encoded.extend(path.as_os_str().encode_wide());
    encoded.push(0);
  }
  encoded.push(0);
  encoded
}

#[cfg(target_os = "windows")]
fn write_filesystem_clipboard_windows(paths: &[PathBuf], mode: &str) -> Result<(), String> {
  use std::mem::size_of;
  use windows_sys::Win32::Foundation::{GlobalFree, POINT};
  use windows_sys::Win32::System::DataExchange::{
    EmptyClipboard, RegisterClipboardFormatW, SetClipboardData,
  };
  use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
  use windows_sys::Win32::System::Ole::CF_HDROP;
  use windows_sys::Win32::UI::Shell::DROPFILES;

  let requested_drop_effect = if mode.eq_ignore_ascii_case("cut") {
    CLIPBOARD_DROPEFFECT_MOVE
  } else {
    CLIPBOARD_DROPEFFECT_COPY
  };

  with_open_clipboard(|| unsafe {
    if EmptyClipboard() == 0 {
      return Err("Failed to clear clipboard.".to_string());
    }

    if paths.is_empty() {
      return Ok(());
    }

    let encoded_paths = encode_clipboard_file_list(paths);
    let header_size = size_of::<DROPFILES>();
    let payload_size = encoded_paths.len() * size_of::<u16>();
    let global_size = header_size + payload_size;

    let dropfiles_handle = GlobalAlloc(GMEM_MOVEABLE, global_size);
    if dropfiles_handle.is_null() {
      return Err("Failed to allocate clipboard memory for file list.".to_string());
    }

    let dropfiles_ptr = GlobalLock(dropfiles_handle) as *mut u8;
    if dropfiles_ptr.is_null() {
      GlobalFree(dropfiles_handle);
      return Err("Failed to lock clipboard memory for file list.".to_string());
    }

    let dropfiles_header = dropfiles_ptr as *mut DROPFILES;
    (*dropfiles_header).pFiles = header_size as u32;
    (*dropfiles_header).pt = POINT { x: 0, y: 0 };
    (*dropfiles_header).fNC = 0;
    (*dropfiles_header).fWide = 1;

    let encoded_ptr = dropfiles_ptr.add(header_size) as *mut u16;
    std::ptr::copy_nonoverlapping(encoded_paths.as_ptr(), encoded_ptr, encoded_paths.len());
    GlobalUnlock(dropfiles_handle);

    if SetClipboardData(CF_HDROP as u32, dropfiles_handle) == std::ptr::null_mut() {
      GlobalFree(dropfiles_handle);
      return Err("Failed to set file list clipboard data.".to_string());
    }

    let format_name = utf16_null_terminated("Preferred DropEffect");
    let preferred_drop_effect_format = RegisterClipboardFormatW(format_name.as_ptr());
    if preferred_drop_effect_format != 0 {
      write_clipboard_drop_effect(preferred_drop_effect_format, requested_drop_effect);
    }

    Ok(())
  })
}

#[cfg(target_os = "windows")]
unsafe fn write_clipboard_drop_effect(format: u32, effect: u32) {
  use std::mem::size_of;
  use windows_sys::Win32::Foundation::GlobalFree;
  use windows_sys::Win32::System::DataExchange::SetClipboardData;
  use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

  let effect_handle = GlobalAlloc(GMEM_MOVEABLE, size_of::<u32>());
  if effect_handle.is_null() {
    return;
  }
  let effect_ptr = GlobalLock(effect_handle) as *mut u32;
  if effect_ptr.is_null() {
    GlobalFree(effect_handle);
    return;
  }
  *effect_ptr = effect;
  GlobalUnlock(effect_handle);
  if SetClipboardData(format, effect_handle) == std::ptr::null_mut() {
    GlobalFree(effect_handle);
  }
}

#[cfg(target_os = "windows")]
fn read_filesystem_clipboard_windows() -> Result<FilesystemClipboardState, String> {
  use std::ffi::OsString;
  use std::os::windows::ffi::OsStringExt;
  use windows_sys::Win32::System::DataExchange::{
    GetClipboardData, IsClipboardFormatAvailable, RegisterClipboardFormatW,
  };
  use windows_sys::Win32::System::Ole::CF_HDROP;
  use windows_sys::Win32::UI::Shell::{DragQueryFileW, HDROP};

  with_open_clipboard(|| unsafe {
    if IsClipboardFormatAvailable(CF_HDROP as u32) == 0 {
      return Ok(FilesystemClipboardState {
        mode: "".to_string(),
        paths: Vec::new(),
      });
    }

    let hdrop_handle = GetClipboardData(CF_HDROP as u32);
    if hdrop_handle.is_null() {
      return Ok(FilesystemClipboardState {
        mode: "".to_string(),
        paths: Vec::new(),
      });
    }

    let hdrop = hdrop_handle as HDROP;
    let file_count = DragQueryFileW(hdrop, 0xFFFF_FFFF, std::ptr::null_mut(), 0);
    let mut paths = Vec::with_capacity(file_count as usize);
    for index in 0..file_count {
      let path_len = DragQueryFileW(hdrop, index, std::ptr::null_mut(), 0);
      if path_len == 0 {
        continue;
      }

      let mut path_buffer = vec![0u16; path_len as usize + 1];
      let written = DragQueryFileW(hdrop, index, path_buffer.as_mut_ptr(), path_len + 1);
      if written == 0 {
        continue;
      }

      let path_os_string = OsString::from_wide(&path_buffer[..written as usize]);
      paths.push(path_os_string.to_string_lossy().to_string());
    }

    let format_name = utf16_null_terminated("Preferred DropEffect");
    let preferred_drop_effect_format = RegisterClipboardFormatW(format_name.as_ptr());
    let mode = read_clipboard_drop_mode(preferred_drop_effect_format);

    Ok(FilesystemClipboardState { mode, paths })
  })
}

#[cfg(target_os = "windows")]
unsafe fn read_clipboard_drop_mode(format: u32) -> String {
  use windows_sys::Win32::System::DataExchange::{GetClipboardData, IsClipboardFormatAvailable};
  use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};

  if format == 0 || IsClipboardFormatAvailable(format) == 0 {
    return "copy".to_string();
  }
  let effect_handle = GetClipboardData(format);
  if effect_handle.is_null() {
    return "copy".to_string();
  }
  let effect_ptr = GlobalLock(effect_handle) as *const u32;
  if effect_ptr.is_null() {
    return "copy".to_string();
  }
  let effect = *effect_ptr;
  GlobalUnlock(effect_handle);
  if (effect & CLIPBOARD_DROPEFFECT_MOVE) != 0 {
    "cut".to_string()
  } else {
    "copy".to_string()
  }
}

#[tauri::command]
pub fn filesystem_clipboard_set(paths: Vec<String>, mode: Option<String>) -> Result<(), String> {
  let normalized_paths: Vec<PathBuf> = paths
    .into_iter()
    .map(|path| path.trim().to_string())
    .filter(|path| !path.is_empty())
    .map(PathBuf::from)
    .collect();
  let normalized_mode = mode.unwrap_or_default().trim().to_lowercase();

  #[cfg(target_os = "windows")]
  {
    return write_filesystem_clipboard_windows(&normalized_paths, &normalized_mode);
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = normalized_paths;
    let _ = normalized_mode;
    Ok(())
  }
}

#[tauri::command]
pub fn filesystem_clipboard_get() -> Result<FilesystemClipboardState, String> {
  #[cfg(target_os = "windows")]
  {
    return read_filesystem_clipboard_windows();
  }

  #[cfg(not(target_os = "windows"))]
  {
    Ok(FilesystemClipboardState {
      mode: "".to_string(),
      paths: Vec::new(),
    })
  }
}
