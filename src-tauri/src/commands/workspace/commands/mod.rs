mod basic;
mod basic_support;
mod lifecycle;

pub use basic::{
  workspace_bootstrap, workspace_get_snapshot, workspace_new_tab, workspace_new_window,
  workspace_set_active_tab, workspace_set_tab_pane_filesystem_state, workspace_set_tab_panel_type,
  workspace_set_tab_selected_files, workspace_set_tab_terminal_cwd, workspace_set_tab_workspace_root,
  workspace_set_window_bounds, workspace_read_folder_config,
};
pub use lifecycle::{
  handle_runtime_window_destroyed, workspace_close_tab, workspace_close_window,
  workspace_detach_tab_to_new_window, workspace_move_tab,
};
