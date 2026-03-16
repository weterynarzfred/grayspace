use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize)]
struct DriveInfo {
    name: String,
    path: String,
}

#[derive(Serialize)]
struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
}

fn sort_entries(entries: &mut [FsEntry]) {
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
}

#[tauri::command]
fn list_drives() -> Vec<DriveInfo> {
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
fn list_directory(path: &str) -> Result<Vec<FsEntry>, String> {
    let mut entries = Vec::new();

    let read_dir = fs::read_dir(path).map_err(|error| error.to_string())?;
    for entry in read_dir {
        let dir_entry = entry.map_err(|error| error.to_string())?;
        let metadata = dir_entry.metadata().map_err(|error| error.to_string())?;
        let entry_path = dir_entry.path();
        let name = dir_entry.file_name().to_string_lossy().to_string();

        entries.push(FsEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
        });
    }

    sort_entries(&mut entries);

    Ok(entries)
}

#[tauri::command]
fn parent_path(path: &str) -> Option<String> {
    Path::new(path)
        .parent()
        .map(|parent| parent.to_string_lossy().to_string())
}

#[tauri::command]
fn open_path(path: &str) -> Result<(), String> {
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
fn move_path(source: &str, destination_dir: &str) -> Result<(), String> {
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

    fs::rename(&source_path, &destination_path).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_drives,
            list_directory,
            parent_path,
            open_path,
            move_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{list_directory, move_path, parent_path};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_root(prefix: &str) -> PathBuf {
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}_{unique_id}"))
    }

    #[test]
    fn list_directory_sorts_directories_before_files() {
        let test_root = unique_test_root("grayspace_test");
        fs::create_dir_all(&test_root).expect("should create temp root");
        fs::create_dir(test_root.join("b_dir")).expect("should create b_dir");
        fs::create_dir(test_root.join("A_dir")).expect("should create A_dir");
        fs::write(test_root.join("b.txt"), "b").expect("should create b.txt");
        fs::write(test_root.join("A.txt"), "a").expect("should create A.txt");

        let test_root_path = test_root.to_string_lossy().to_string();
        let entries = list_directory(&test_root_path).expect("list_directory should succeed");
        let ordered_names: Vec<String> = entries.into_iter().map(|entry| entry.name).collect();

        fs::remove_dir_all(&test_root).expect("should clean up temp root");

        assert_eq!(ordered_names, vec!["A_dir", "b_dir", "A.txt", "b.txt"]);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parent_path_handles_windows_paths() {
        assert_eq!(
            parent_path(r"C:\Users\alice"),
            Some(r"C:\Users".to_string())
        );
        assert_eq!(parent_path(r"C:\"), None);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parent_path_drive_root_edge_cases() {
        assert_eq!(parent_path(r"C:\\"), None);
        assert_eq!(parent_path(r"D:\"), None);
        assert_eq!(
            parent_path(r"C:\Users\alice\"),
            Some(r"C:\Users".to_string())
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn parent_path_handles_unix_paths() {
        assert_eq!(parent_path("/usr/local"), Some("/usr".to_string()));
        assert_eq!(parent_path("/"), None);
    }

    #[test]
    fn parent_path_handles_relative_paths() {
        let path = PathBuf::from("foo").join("bar");
        let path_string = path.to_string_lossy().to_string();
        assert_eq!(parent_path(&path_string), Some("foo".to_string()));
    }

    #[test]
    fn list_directory_returns_error_for_missing_path() {
        let missing_path = unique_test_root("grayspace_missing")
            .to_string_lossy()
            .to_string();

        let result = list_directory(&missing_path);
        assert!(result.is_err());
    }

    #[test]
    fn move_path_moves_file_into_destination_folder() {
        let test_root = unique_test_root("grayspace_move");
        let source_dir = test_root.join("source");
        let destination_dir = test_root.join("destination");
        let source_file = source_dir.join("notes.txt");

        fs::create_dir_all(&source_dir).expect("should create source dir");
        fs::create_dir_all(&destination_dir).expect("should create destination dir");
        fs::write(&source_file, "hello").expect("should create source file");

        let source = source_file.to_string_lossy().to_string();
        let destination = destination_dir.to_string_lossy().to_string();
        move_path(&source, &destination).expect("move_path should move file");

        assert!(!source_file.exists(), "source file should be moved out");
        assert!(
            destination_dir.join("notes.txt").exists(),
            "destination should contain moved file"
        );

        fs::remove_dir_all(&test_root).expect("should clean up temp root");
    }

    #[test]
    fn move_path_rejects_moving_folder_into_descendant() {
        let test_root = unique_test_root("grayspace_move_descendant");
        let parent_dir = test_root.join("photos");
        let child_dir = parent_dir.join("archive");

        fs::create_dir_all(&child_dir).expect("should create nested directories");

        let source = parent_dir.to_string_lossy().to_string();
        let destination = child_dir.to_string_lossy().to_string();
        let result = move_path(&source, &destination);

        assert!(result.is_err());
        assert!(result
            .expect_err("should return an error")
            .contains("Cannot move a folder into itself or one of its descendants."));

        fs::remove_dir_all(&test_root).expect("should clean up temp root");
    }

    #[test]
    fn move_path_rejects_destination_name_collision() {
        let test_root = unique_test_root("grayspace_move_collision");
        let source_dir = test_root.join("source");
        let destination_dir = test_root.join("destination");
        let source_file = source_dir.join("notes.txt");
        let destination_file = destination_dir.join("notes.txt");

        fs::create_dir_all(&source_dir).expect("should create source dir");
        fs::create_dir_all(&destination_dir).expect("should create destination dir");
        fs::write(&source_file, "source").expect("should create source file");
        fs::write(&destination_file, "destination").expect("should create destination file");

        let source = source_file.to_string_lossy().to_string();
        let destination = destination_dir.to_string_lossy().to_string();
        let result = move_path(&source, &destination);

        assert!(result.is_err());
        assert!(result
            .expect_err("should return an error")
            .contains("already exists in the destination folder"));
        assert!(source_file.exists(), "source file should remain in place");

        fs::remove_dir_all(&test_root).expect("should clean up temp root");
    }
}
