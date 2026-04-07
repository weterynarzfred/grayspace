mod commands;

use tauri::Manager;

use commands::filesystem::{
  create_folder, create_text_file,
  delete_paths, filesystem_get_properties, filesystem_watch_start, filesystem_watch_stop,
  filesystem_clipboard_get, filesystem_clipboard_set,
  filesystem_resolve_workspace_folders, handle_filesystem_window_destroyed, import_paths,
  keyboard_modifier_state,
  list_directory, list_directory_page, list_drives, move_path, open_path, parent_path,
  rename_path,
  start_external_drag, FilesystemDirectoryListingState, FilesystemWatchState,
};
use commands::preview::{preview_read_file, preview_write_text_file};
use commands::terminal::{
  terminal_resize, terminal_run_command, terminal_set_cwd, terminal_start, terminal_stop,
  terminal_write, TerminalState,
};
use commands::thumbnail::{
  thumbnail_clear_cache, thumbnail_prune_cache, thumbnail_resolve_batch, ThumbnailState,
};
use commands::workspace::{
  handle_runtime_window_destroyed, workspace_bootstrap, workspace_close_tab,
  workspace_close_tab_pane, workspace_close_window, workspace_detach_tab_to_new_window,
  workspace_get_snapshot, workspace_move_tab, workspace_new_tab, workspace_new_window,
  workspace_open_folder_from_tab, workspace_open_workspace_folder_from_tab,
  workspace_recent_folders_list, workspace_recent_folders_record, workspace_recent_folders_remove,
  workspace_replace_tab_folder,
  workspace_read_folder_config,
  workspace_set_active_tab, workspace_set_tab_active_pane, workspace_set_tab_layout_split_ratio,
  workspace_set_tab_pane_filesystem_state, workspace_set_tab_panel_type,
  workspace_set_tab_selected_files, workspace_set_tab_terminal_cwd,
  workspace_set_tab_workspace_root, workspace_set_window_bounds, workspace_split_tab_pane,
  WorkspaceState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(TerminalState::default())
    .manage(WorkspaceState::default())
    .manage(FilesystemWatchState::default())
    .manage(FilesystemDirectoryListingState::default())
    .manage(ThumbnailState::default())
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::Destroyed = event {
        let app_handle = window.app_handle();
        let workspace_state = app_handle.state::<WorkspaceState>();
        let terminal_state = app_handle.state::<TerminalState>();
        let filesystem_watch_state = app_handle.state::<FilesystemWatchState>();
        handle_runtime_window_destroyed(
          &app_handle,
          &workspace_state,
          &terminal_state,
          window.label(),
        );
        handle_filesystem_window_destroyed(&filesystem_watch_state, window.label());
      }
    })
    .invoke_handler(tauri::generate_handler![
      list_drives,
      list_directory,
      list_directory_page,
      filesystem_resolve_workspace_folders,
      filesystem_get_properties,
      parent_path,
      open_path,
      move_path,
      rename_path,
      create_text_file,
      create_folder,
      delete_paths,
      import_paths,
      filesystem_clipboard_set,
      filesystem_clipboard_get,
      preview_read_file,
      preview_write_text_file,
      thumbnail_resolve_batch,
      thumbnail_prune_cache,
      thumbnail_clear_cache,
      filesystem_watch_start,
      filesystem_watch_stop,
      keyboard_modifier_state,
      start_external_drag,
      terminal_start,
      terminal_write,
      terminal_run_command,
      terminal_resize,
      terminal_set_cwd,
      terminal_stop,
      workspace_bootstrap,
      workspace_get_snapshot,
      workspace_new_window,
      workspace_new_tab,
      workspace_set_active_tab,
      workspace_set_tab_active_pane,
      workspace_set_tab_layout_split_ratio,
      workspace_set_tab_panel_type,
      workspace_set_tab_terminal_cwd,
      workspace_set_tab_pane_filesystem_state,
      workspace_split_tab_pane,
      workspace_close_tab_pane,
      workspace_set_tab_selected_files,
      workspace_set_tab_workspace_root,
      workspace_open_folder_from_tab,
      workspace_open_workspace_folder_from_tab,
      workspace_replace_tab_folder,
      workspace_recent_folders_list,
      workspace_recent_folders_record,
      workspace_recent_folders_remove,
      workspace_read_folder_config,
      workspace_move_tab,
      workspace_detach_tab_to_new_window,
      workspace_close_tab,
      workspace_close_window,
      workspace_set_window_bounds
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
