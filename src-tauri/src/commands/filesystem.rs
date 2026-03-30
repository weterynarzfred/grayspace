use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State};

#[derive(Serialize)]
pub struct DriveInfo {
    name: String,
    path: String,
}

#[derive(Serialize)]
pub struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsPathProperties {
    path: String,
    size_bytes: Option<u64>,
    entry_type: String,
    date_modified_ms: Option<u64>,
    date_created_ms: Option<u64>,
}

const FILESYSTEM_WATCH_EVENT: &str = "filesystem-watch-event";

#[derive(Default)]
pub struct FilesystemWatchState {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FilesystemWatchEventPayload {
    watch_id: String,
    changed_path: String,
}

#[cfg(target_os = "windows")]
const CROSS_DEVICE_ERROR_CODE: i32 = 17;
#[cfg(not(target_os = "windows"))]
const CROSS_DEVICE_ERROR_CODE: i32 = 18;

fn watch_state_key(window_label: &str, watch_id: &str) -> String {
    format!("{window_label}::{watch_id}")
}

fn is_watch_event_relevant(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Any | EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}

fn sort_entries(entries: &mut [FsEntry]) {
    entries.sort_by_cached_key(|entry| (!entry.is_dir, entry.name.to_lowercase()));
}

fn infer_entry_type(path: &Path, is_dir: bool) -> String {
    if is_dir {
        return "Folder".to_string();
    }

    path.extension()
        .and_then(|extension| extension.to_str())
        .map(str::trim)
        .filter(|extension| !extension.is_empty())
        .map(|extension| format!("{} file", extension.to_uppercase()))
        .unwrap_or_else(|| "File".to_string())
}

fn system_time_to_epoch_millis(value: Result<SystemTime, std::io::Error>) -> Option<u64> {
    value.ok().and_then(|time| {
        time.duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|duration| u64::try_from(duration.as_millis()).ok())
    })
}

fn is_cross_device_error(error: &std::io::Error) -> bool {
    matches!(error.raw_os_error(), Some(code) if code == CROSS_DEVICE_ERROR_CODE)
}

fn remove_source_path(source_path: &Path) -> Result<(), String> {
    if source_path.is_dir() {
        fs::remove_dir_all(source_path).map_err(|error| error.to_string())?;
    } else {
        fs::remove_file(source_path).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn handle_move_rename_error(
    source_path: &Path,
    destination_path: &Path,
    rename_error: std::io::Error,
) -> Result<(), String> {
    if !is_cross_device_error(&rename_error) {
        return Err(rename_error.to_string());
    }

    copy_path_recursive(source_path, destination_path)?;
    remove_source_path(source_path)
}

#[tauri::command]
pub fn list_drives() -> Vec<DriveInfo> {
    #[cfg(target_os = "windows")]
    {
        (b'A'..=b'Z')
            .filter_map(|letter| {
                let name = format!("{}:", letter as char);
                let path = format!("{name}\\");
                if Path::new(&path).is_dir() {
                    Some(DriveInfo { name, path })
                } else {
                    None
                }
            })
            .collect()
    }

    #[cfg(not(target_os = "windows"))]
    {
        vec![DriveInfo {
            name: "/".to_string(),
            path: "/".to_string(),
        }]
    }
}

#[tauri::command]
pub fn list_directory(path: &str) -> Result<Vec<FsEntry>, String> {
    let mut entries = Vec::new();

    let read_dir = fs::read_dir(path).map_err(|error| error.to_string())?;
    for entry in read_dir {
        let dir_entry = entry.map_err(|error| error.to_string())?;
        let entry_path = dir_entry.path();
        let name = dir_entry.file_name().to_string_lossy().to_string();
        let is_dir = dir_entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir();

        entries.push(FsEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
        });
    }

    sort_entries(&mut entries);

    Ok(entries)
}

#[tauri::command]
pub fn filesystem_get_properties(path: &str) -> Result<FsPathProperties, String> {
    let normalized_path = path.trim();
    if normalized_path.is_empty() {
        return Err("A path is required.".to_string());
    }

    let target_path = PathBuf::from(normalized_path);
    if !target_path.exists() {
        return Err(format!("The path '{}' does not exist.", normalized_path));
    }

    let metadata = fs::metadata(&target_path).map_err(|error| error.to_string())?;
    let is_dir = metadata.is_dir();

    Ok(FsPathProperties {
        path: normalized_path.to_string(),
        size_bytes: (!is_dir).then_some(metadata.len()),
        entry_type: infer_entry_type(&target_path, is_dir),
        date_modified_ms: system_time_to_epoch_millis(metadata.modified()),
        date_created_ms: system_time_to_epoch_millis(metadata.created()),
    })
}

#[tauri::command]
pub fn parent_path(path: &str) -> Option<String> {
    Path::new(path)
        .parent()
        .map(|parent| parent.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_path(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", path])
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Opening paths is not supported on this platform.".to_string())
}

#[tauri::command]
pub fn move_path(source: &str, destination_dir: &str) -> Result<(), String> {
    let source_path = PathBuf::from(source);
    let destination_dir_path = PathBuf::from(destination_dir);

    if !source_path.exists() {
        return Err("The source path does not exist.".to_string());
    }

    if !destination_dir_path.is_dir() {
        return Err("The destination must be an existing folder.".to_string());
    }

    let source_canonical = fs::canonicalize(&source_path).map_err(|error| error.to_string())?;
    let destination_canonical =
        fs::canonicalize(&destination_dir_path).map_err(|error| error.to_string())?;

    if source_canonical == destination_canonical {
        return Err("Cannot move a file or folder into itself.".to_string());
    }

    if source_canonical.is_dir() && destination_canonical.starts_with(&source_canonical) {
        return Err("Cannot move a folder into itself or one of its descendants.".to_string());
    }

    let source_name = source_path
        .file_name()
        .ok_or_else(|| "Cannot determine the item name for this path.".to_string())?;

    let destination_path = destination_dir_path.join(source_name);
    if destination_path.exists() {
        return Err(format!(
            "An item named '{}' already exists in the destination folder.",
            source_name.to_string_lossy()
        ));
    }

    match fs::rename(&source_path, &destination_path) {
        Ok(()) => Ok(()),
        Err(rename_error) => handle_move_rename_error(&source_path, &destination_path, rename_error),
    }
}

#[tauri::command]
pub fn delete_paths(paths: Vec<String>) -> Result<(), String> {
    let normalized_paths: Vec<PathBuf> = paths
        .into_iter()
        .filter_map(|path| (!path.trim().is_empty()).then_some(PathBuf::from(path)))
        .collect();

    if normalized_paths.is_empty() {
        return Err("No paths were provided for deletion.".to_string());
    }

    for path in normalized_paths {
        if !path.exists() {
            return Err(format!(
                "The path '{}' does not exist.",
                path.to_string_lossy()
            ));
        }

        if path.is_dir() {
            fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
        } else {
            fs::remove_file(&path).map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn copy_path_recursive(source_path: &Path, destination_path: &Path) -> Result<(), String> {
    if source_path.is_dir() {
        fs::create_dir(destination_path).map_err(|error| error.to_string())?;

        let read_dir = fs::read_dir(source_path).map_err(|error| error.to_string())?;
        for entry in read_dir {
            let source_entry = entry.map_err(|error| error.to_string())?;
            let source_entry_path = source_entry.path();
            let destination_entry_path = destination_path.join(source_entry.file_name());
            copy_path_recursive(&source_entry_path, &destination_entry_path)?;
        }

        return Ok(());
    }

    fs::copy(source_path, destination_path)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn import_single_path(source_path: &Path, destination_dir_path: &Path) -> Result<(), String> {
    if !source_path.exists() {
        return Err(format!(
            "The source path '{}' does not exist.",
            source_path.to_string_lossy()
        ));
    }

    let source_name = source_path
        .file_name()
        .ok_or_else(|| "Cannot determine the item name for this path.".to_string())?;
    let destination_path = destination_dir_path.join(source_name);

    if destination_path.exists() {
        return Err(format!(
            "An item named '{}' already exists in the destination folder.",
            source_name.to_string_lossy()
        ));
    }

    let source_canonical = fs::canonicalize(source_path).map_err(|error| error.to_string())?;
    let destination_canonical =
        fs::canonicalize(destination_dir_path).map_err(|error| error.to_string())?;

    if source_canonical == destination_canonical {
        return Err("Cannot import a file or folder into itself.".to_string());
    }

    if source_canonical.is_dir() && destination_canonical.starts_with(&source_canonical) {
        return Err("Cannot import a folder into itself or one of its descendants.".to_string());
    }

    copy_path_recursive(source_path, &destination_path)
}

#[tauri::command]
pub fn import_paths(paths: Vec<String>, destination_dir: &str) -> Result<(), String> {
    if paths.is_empty() {
        return Err("No paths were provided for import.".to_string());
    }

    let destination_dir_path = PathBuf::from(destination_dir);
    if !destination_dir_path.is_dir() {
        return Err("The destination must be an existing folder.".to_string());
    }

    for source in paths {
        let source_path = PathBuf::from(source);
        import_single_path(&source_path, &destination_dir_path)?;
    }

    Ok(())
}

#[tauri::command]
pub fn filesystem_watch_start(
    window: tauri::Window,
    state: State<FilesystemWatchState>,
    watch_id: &str,
    path: &str,
) -> Result<(), String> {
    let normalized_watch_id = watch_id.trim();
    if normalized_watch_id.is_empty() {
        return Err("A watcher id is required.".to_string());
    }

    let watch_path = PathBuf::from(path);
    if !watch_path.is_dir() {
        return Err("The watcher path must be an existing folder.".to_string());
    }

    let canonical_watch_path = fs::canonicalize(&watch_path).map_err(|error| error.to_string())?;
    let app_handle = window.app_handle().clone();
    let window_label = window.label().to_string();
    let watcher_key = watch_state_key(&window_label, normalized_watch_id);
    let watched_id = normalized_watch_id.to_string();

    let mut watcher =
        notify::recommended_watcher(move |event_result: notify::Result<notify::Event>| {
            let event = match event_result {
                Ok(event) => event,
                Err(_) => return,
            };

            if !is_watch_event_relevant(&event.kind) {
                return;
            }

            let changed_path = event
                .paths
                .first()
                .map(|entry_path| entry_path.to_string_lossy().to_string())
                .unwrap_or_default();

            let _ = app_handle.emit(
                FILESYSTEM_WATCH_EVENT,
                FilesystemWatchEventPayload {
                    watch_id: watched_id.clone(),
                    changed_path,
                },
            );
        })
        .map_err(|error| error.to_string())?;

    watcher
        .watch(&canonical_watch_path, RecursiveMode::NonRecursive)
        .map_err(|error| error.to_string())?;

    let mut watchers = state
        .watchers
        .lock()
        .map_err(|_| "Failed to access filesystem watcher state.".to_string())?;
    watchers.insert(watcher_key, watcher);
    Ok(())
}

#[tauri::command]
pub fn filesystem_watch_stop(
    window: tauri::Window,
    state: State<FilesystemWatchState>,
    watch_id: &str,
) -> Result<(), String> {
    let normalized_watch_id = watch_id.trim();
    if normalized_watch_id.is_empty() {
        return Ok(());
    }

    let mut watchers = state
        .watchers
        .lock()
        .map_err(|_| "Failed to access filesystem watcher state.".to_string())?;
    let watcher_key = watch_state_key(window.label(), normalized_watch_id);
    watchers.remove(&watcher_key);
    Ok(())
}

pub fn handle_filesystem_window_destroyed(state: &State<FilesystemWatchState>, window_label: &str) {
    let window_prefix = format!("{window_label}::");
    let mut watchers = match state.watchers.lock() {
        Ok(watchers) => watchers,
        Err(_) => return,
    };

    watchers.retain(|watcher_key, _| !watcher_key.starts_with(&window_prefix));
}

#[tauri::command]
pub fn start_external_drag(window: tauri::Window, paths: Vec<String>) -> Result<(), String> {
    let normalized_paths: Vec<PathBuf> = paths
        .into_iter()
        .filter_map(|path| (!path.is_empty()).then_some(PathBuf::from(path)))
        .collect();

    if normalized_paths.is_empty() {
        return Err("No paths were provided for drag.".to_string());
    }

    let mut drag_paths = Vec::with_capacity(normalized_paths.len());
    for path in normalized_paths {
        if !path.exists() {
            return Err(format!(
                "The path '{}' does not exist.",
                path.to_string_lossy()
            ));
        }

        drag_paths.push(fs::canonicalize(path).map_err(|error| error.to_string())?);
    }

    let drag_item = drag::DragItem::Files(drag_paths);
    let preview_icon = drag::Image::Raw(include_bytes!("../../icons/32x32.png").to_vec());

    drag::start_drag(
        #[cfg(target_os = "linux")]
        &window.gtk_window().map_err(|error| error.to_string())?,
        #[cfg(not(target_os = "linux"))]
        &window,
        drag_item,
        preview_icon,
        |_drag_result, _cursor_position| {},
        drag::Options::default(),
    )
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests;
