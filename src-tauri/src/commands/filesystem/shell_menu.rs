//! Shows the Windows Explorer context menu, so shell extensions (7-Zip, Git, "Open with",
//! "Send to", ...) are reachable without grayspace reimplementing them.

use serde::Deserialize;
use std::path::Path;
use std::sync::mpsc;
use tauri::Window;

/// Verbs grayspace runs itself: the shell would open folders in Explorer and has no view to rename in.
const HOST_VERBS: [&str; 3] = ["open", "explore", "rename"];

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ShellMenuTarget {
  Items { paths: Vec<String> },
  Background { folder: String },
}

fn items_share_folder(paths: &[String]) -> bool {
  let first_parent = Path::new(&paths[0]).parent();
  paths.iter().all(|path| Path::new(path).parent() == first_parent)
}

fn validate_target(target: &ShellMenuTarget) -> Result<(), String> {
  match target {
    ShellMenuTarget::Items { paths } if paths.is_empty() => Err("No items were provided for the Windows menu.".into()),
    // The shell resolves every item relative to the first item's folder.
    ShellMenuTarget::Items { paths } if !items_share_folder(paths) => {
      Err("The Windows menu can only show items from one folder.".into())
    }
    _ => Ok(()),
  }
}

/// Shows the menu at `x`/`y` (CSS pixels inside the window) and runs the picked command.
/// Returns the verb when it is one grayspace should run itself, `None` otherwise.
#[tauri::command]
pub async fn filesystem_show_shell_menu(
  window: Window,
  target: ShellMenuTarget,
  x: f64,
  y: f64,
  extended: bool,
) -> Result<Option<String>, String> {
  validate_target(&target)?;
  // The menu must be tracked on the thread that owns the window, and its modal loop must not run
  // inside a WebView2 IPC callback, so it runs as a separate main-thread task.
  let (sender, receiver) = mpsc::channel();
  let menu_window = window.clone();
  window
    .run_on_main_thread(move || {
      let _ = sender.send(platform::show_shell_menu(&menu_window, &target, x, y, extended));
    })
    .map_err(|error| error.to_string())?;
  tauri::async_runtime::spawn_blocking(move || receiver.recv())
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())?
}

#[cfg(windows)]
mod platform {
  use super::{ShellMenuTarget, HOST_VERBS};
  use tauri::Window;
  use windows::core::{Interface, HSTRING, PCSTR, PCWSTR, PSTR};
  use windows::Win32::Foundation::{ERROR_CANCELLED, HWND, LPARAM, LRESULT, POINT, WPARAM};
  use windows::Win32::System::Com::IBindCtx;
  use windows::Win32::UI::Shell::Common::ITEMIDLIST;
  use windows::Win32::UI::Shell::{
    DefSubclassProc, ILFindLastID, ILFree, IContextMenu, IContextMenu3, IShellFolder, RemoveWindowSubclass,
    SHBindToObject, SHBindToParent, SHParseDisplayName, SetWindowSubclass, CMF_CANRENAME, CMF_EXTENDEDVERBS,
    CMF_NORMAL, CMIC_MASK_PTINVOKE, CMINVOKECOMMANDINFO, CMINVOKECOMMANDINFOEX, GCS_VERBW,
  };
  use windows::Win32::UI::WindowsAndMessaging::{
    CreatePopupMenu, DestroyMenu, TrackPopupMenuEx, HMENU, SW_SHOWNORMAL, TPM_RETURNCMD, TPM_RIGHTBUTTON,
    WM_DRAWITEM, WM_INITMENUPOPUP, WM_MEASUREITEM, WM_MENUCHAR,
  };

  const FIRST_COMMAND_ID: u32 = 1;
  const LAST_COMMAND_ID: u32 = 0x7fff;
  // Not exported by windows-rs.
  const CMIC_MASK_UNICODE: u32 = 0x4000;
  const SUBCLASS_ID: usize = 0x6773_6d6e;

  struct Pidl(*mut ITEMIDLIST);

  impl Pidl {
    fn parse(path: &str) -> Result<Self, String> {
      let mut pidl = std::ptr::null_mut();
      unsafe { SHParseDisplayName(&HSTRING::from(path), None::<&IBindCtx>, &mut pidl, 0, None) }
        .map_err(|error| format!("Windows could not open '{path}': {}", error.message()))?;
      Ok(Self(pidl))
    }
  }

  impl Drop for Pidl {
    fn drop(&mut self) {
      unsafe { ILFree(Some(self.0 as *const _)) };
    }
  }

  fn items_menu(hwnd: HWND, paths: &[String]) -> Result<IContextMenu, String> {
    let pidls = paths.iter().map(|path| Pidl::parse(path)).collect::<Result<Vec<_>, _>>()?;
    let parent: IShellFolder = unsafe { SHBindToParent(pidls[0].0, None) }.map_err(|error| error.message())?;
    let children: Vec<*const ITEMIDLIST> = pidls.iter().map(|pidl| unsafe { ILFindLastID(pidl.0) } as *const _).collect();
    unsafe { parent.GetUIObjectOf(hwnd, &children, None) }.map_err(|error| error.message())
  }

  fn background_menu(hwnd: HWND, folder: &str) -> Result<IContextMenu, String> {
    let pidl = Pidl::parse(folder)?;
    let shell_folder: IShellFolder =
      unsafe { SHBindToObject(None::<&IShellFolder>, pidl.0, None::<&IBindCtx>) }.map_err(|error| error.message())?;
    unsafe { shell_folder.CreateViewObject(hwnd) }.map_err(|error| error.message())
  }

  /// Submenus such as "Send to" and "Open with" are filled and drawn by the handler while the menu
  /// is open, through messages sent to the owner window.
  unsafe extern "system" fn forward_menu_message(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    context_menu: usize,
  ) -> LRESULT {
    if matches!(message, WM_INITMENUPOPUP | WM_DRAWITEM | WM_MEASUREITEM | WM_MENUCHAR) {
      if let Some(context_menu) = unsafe { &*(context_menu as *const Option<IContextMenu3>) } {
        let mut result = LRESULT(0);
        if unsafe { context_menu.HandleMenuMsg2(message, wparam, lparam, Some(&mut result)) }.is_ok() {
          return result;
        }
      }
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
  }

  fn command_verb(context_menu: &IContextMenu, command_offset: u32) -> Option<String> {
    let mut buffer = [0u16; 256];
    unsafe {
      context_menu.GetCommandString(
        command_offset as usize,
        GCS_VERBW,
        None,
        PSTR(buffer.as_mut_ptr().cast()),
        buffer.len() as u32,
      )
    }
    .ok()?;
    let length = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..length]))
  }

  fn screen_point(window: &Window, x: f64, y: f64) -> Result<POINT, String> {
    let origin = window.inner_position().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    Ok(POINT {
      x: origin.x + (x * scale).round() as i32,
      y: origin.y + (y * scale).round() as i32,
    })
  }

  fn track_and_invoke(
    hwnd: HWND,
    context_menu: &IContextMenu,
    menu: HMENU,
    point: POINT,
    extended: bool,
  ) -> Result<Option<String>, String> {
    let flags = CMF_NORMAL | CMF_CANRENAME | if extended { CMF_EXTENDEDVERBS } else { 0 };
    unsafe { context_menu.QueryContextMenu(menu, 0, FIRST_COMMAND_ID, LAST_COMMAND_ID, flags) }
      .ok()
      .map_err(|error| error.message())?;

    let menu_handler = context_menu.cast::<IContextMenu3>().ok();
    let chosen_id = unsafe {
      let _ = SetWindowSubclass(hwnd, Some(forward_menu_message), SUBCLASS_ID, &menu_handler as *const _ as usize);
      let chosen = TrackPopupMenuEx(menu, (TPM_RETURNCMD | TPM_RIGHTBUTTON).0, point.x, point.y, hwnd, None);
      let _ = RemoveWindowSubclass(hwnd, Some(forward_menu_message), SUBCLASS_ID);
      chosen.0 as u32
    };
    if chosen_id == 0 {
      return Ok(None);
    }

    let command_offset = chosen_id - FIRST_COMMAND_ID;
    let verb = command_verb(context_menu, command_offset);
    if let Some(verb) = verb.filter(|verb| HOST_VERBS.contains(&verb.as_str())) {
      return Ok(Some(verb));
    }

    // MAKEINTRESOURCE: the verb fields carry the command offset instead of a string.
    let invoke_info = CMINVOKECOMMANDINFOEX {
      cbSize: size_of::<CMINVOKECOMMANDINFOEX>() as u32,
      fMask: CMIC_MASK_UNICODE | CMIC_MASK_PTINVOKE,
      hwnd,
      lpVerb: PCSTR(command_offset as usize as *const u8),
      lpVerbW: PCWSTR(command_offset as usize as *const u16),
      nShow: SW_SHOWNORMAL.0,
      ptInvoke: point,
      ..Default::default()
    };
    match unsafe { context_menu.InvokeCommand(&invoke_info as *const _ as *const CMINVOKECOMMANDINFO) } {
      Err(error) if error.code() == ERROR_CANCELLED.to_hresult() => Ok(None),
      result => result.map(|_| None).map_err(|error| error.message()),
    }
  }

  pub(super) fn show_shell_menu(
    window: &Window,
    target: &ShellMenuTarget,
    x: f64,
    y: f64,
    extended: bool,
  ) -> Result<Option<String>, String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let point = screen_point(window, x, y)?;
    let context_menu = match target {
      ShellMenuTarget::Items { paths } => items_menu(hwnd, paths),
      ShellMenuTarget::Background { folder } => background_menu(hwnd, folder),
    }?;

    let menu = unsafe { CreatePopupMenu() }.map_err(|error| error.message())?;
    let result = track_and_invoke(hwnd, &context_menu, menu, point, extended);
    let _ = unsafe { DestroyMenu(menu) };
    result
  }
}

#[cfg(not(windows))]
mod platform {
  use super::ShellMenuTarget;
  use tauri::Window;

  pub(super) fn show_shell_menu(
    _window: &Window,
    _target: &ShellMenuTarget,
    _x: f64,
    _y: f64,
    _extended: bool,
  ) -> Result<Option<String>, String> {
    Err("The Windows menu is only available on Windows.".into())
  }
}

#[cfg(test)]
mod tests;
