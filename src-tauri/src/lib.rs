mod commands;

use tauri::Manager;

use commands::filesystem::{
    delete_paths, filesystem_watch_start, filesystem_watch_stop,
    filesystem_get_properties, handle_filesystem_window_destroyed, import_paths, list_directory,
    list_drives, move_path, open_path, parent_path, start_external_drag, FilesystemWatchState,
};
use commands::preview::{preview_read_file, preview_write_text_file};
use commands::terminal::{
    terminal_resize, terminal_run_command, terminal_set_cwd, terminal_start, terminal_stop,
    terminal_write, TerminalState,
};
use commands::workspace::{
    handle_runtime_window_destroyed, workspace_bootstrap, workspace_close_tab,
    workspace_close_tab_pane, workspace_close_window, workspace_detach_tab_to_new_window,
    workspace_get_snapshot, workspace_move_tab, workspace_new_tab, workspace_new_window,
    workspace_read_folder_config, workspace_set_active_tab, workspace_set_tab_active_pane,
    workspace_set_tab_layout_split_ratio,
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
            filesystem_get_properties,
            parent_path,
            open_path,
            move_path,
            delete_paths,
            import_paths,
            preview_read_file,
            preview_write_text_file,
            filesystem_watch_start,
            filesystem_watch_stop,
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
