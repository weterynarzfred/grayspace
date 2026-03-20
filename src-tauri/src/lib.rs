mod commands;

use tauri::Manager;

use commands::filesystem::{
  import_paths, list_directory, list_drives, move_path, open_path, parent_path,
  start_external_drag,
};
use commands::terminal::{
  terminal_resize, terminal_set_cwd, terminal_start, terminal_stop, terminal_write, TerminalState,
};
use commands::workspace::{
  handle_runtime_window_destroyed, workspace_bootstrap, workspace_close_tab,
  workspace_close_window, workspace_detach_tab_to_new_window, workspace_get_snapshot,
  workspace_move_tab, workspace_new_tab, workspace_new_window, workspace_set_active_tab,
  workspace_set_tab_pane_filesystem_state, workspace_set_tab_panel_type,
  workspace_set_tab_terminal_cwd, workspace_set_tab_workspace_root, workspace_set_window_bounds,
  WorkspaceState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(TerminalState::default())
    .manage(WorkspaceState::default())
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::Destroyed = event {
        let app_handle = window.app_handle();
        let workspace_state = app_handle.state::<WorkspaceState>();
        let terminal_state = app_handle.state::<TerminalState>();
        handle_runtime_window_destroyed(
          &app_handle,
          &workspace_state,
          &terminal_state,
          window.label(),
        );
      }
    })
    .invoke_handler(tauri::generate_handler![
      list_drives,
      list_directory,
      parent_path,
      open_path,
      move_path,
      import_paths,
      start_external_drag,
      terminal_start,
      terminal_write,
      terminal_resize,
      terminal_set_cwd,
      terminal_stop,
      workspace_bootstrap,
      workspace_get_snapshot,
      workspace_new_window,
      workspace_new_tab,
      workspace_set_active_tab,
      workspace_set_tab_panel_type,
      workspace_set_tab_terminal_cwd,
      workspace_set_tab_pane_filesystem_state,
      workspace_set_tab_workspace_root,
      workspace_move_tab,
      workspace_detach_tab_to_new_window,
      workspace_close_tab,
      workspace_close_window,
      workspace_set_window_bounds
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
