use super::super::watcher::{restart_watchers_on_path, FilesystemWatchState};
use super::path_error;
use std::fs;
use std::path::Path;
use tauri::Manager;

/// Undo of a merging move recreates the source folders it removed before moving items back. A
/// watch on a removed folder stays on the removed one, so the watches on exactly these folders
/// start again; one on a child that moved whole followed it and still works. Runs off the main
/// thread, as a big merge can remove many folders.
#[tauri::command]
pub async fn recreate_folders(window: tauri::Window, paths: Vec<String>) -> Result<(), String> {
  let app_handle = window.app_handle().clone();
  tauri::async_runtime::spawn_blocking(move || {
    create_folders(&paths)?;
    let watch_state = app_handle.state::<FilesystemWatchState>();
    for path in &paths {
      if let Ok(canonical_path) = fs::canonicalize(path) {
        restart_watchers_on_path(&watch_state, &app_handle, &canonical_path);
      }
    }
    Ok(())
  })
  .await
  .map_err(|error| error.to_string())?
}

fn create_folders(paths: &[String]) -> Result<(), String> {
  paths
    .iter()
    .try_for_each(|path| fs::create_dir_all(path).map_err(|error| path_error(Path::new(path), error)))
}

/// Redo of a merging move removes the source folders it emptied again, deepest first; one that is
/// not empty stays.
#[tauri::command]
pub async fn remove_empty_folders(paths: Vec<String>) -> Result<(), String> {
  tauri::async_runtime::spawn_blocking(move || remove_empty_folders_core(&paths))
    .await
    .map_err(|error| error.to_string())
}

fn remove_empty_folders_core(paths: &[String]) {
  for path in paths {
    let _ = fs::remove_dir(path);
  }
}

#[cfg(test)]
mod tests;
