use serde::Serialize;
use std::fs;
use std::path::Path;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_drives,
            list_directory,
            parent_path,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{list_directory, parent_path};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn list_directory_sorts_directories_before_files() {
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();

        let test_root = std::env::temp_dir().join(format!("grayspace_test_{unique_id}"));
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
        let unique_id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let missing_path = std::env::temp_dir()
            .join(format!("grayspace_missing_{unique_id}"))
            .to_string_lossy()
            .to_string();

        let result = list_directory(&missing_path);
        assert!(result.is_err());
    }
}
