mod commands;

use commands::filesystem::{
    import_paths, list_directory, list_drives, move_path, open_path, parent_path,
};
use commands::terminal::{
    terminal_resize, terminal_set_cwd, terminal_start, terminal_stop, terminal_write, TerminalState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            list_drives,
            list_directory,
            parent_path,
            open_path,
            move_path,
            import_paths,
            terminal_start,
            terminal_write,
            terminal_resize,
            terminal_set_cwd,
            terminal_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
