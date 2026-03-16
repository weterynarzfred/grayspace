use serde::Serialize;
use std::fs;
use std::path::Path;

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

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[tauri::command]
fn parent_path(path: &str) -> Option<String> {
    Path::new(path)
        .parent()
        .map(|parent| parent.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_drives,
            list_directory,
            parent_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
