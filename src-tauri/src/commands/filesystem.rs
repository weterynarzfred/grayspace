use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

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

fn sort_entries(entries: &mut [FsEntry]) {
  entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
    (true, false) => std::cmp::Ordering::Less,
    (false, true) => std::cmp::Ordering::Greater,
    _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
  });
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

  fs::rename(&source_path, &destination_path).map_err(|error| error.to_string())
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
mod tests {
  use super::{import_paths, list_directory, move_path, parent_path};
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

  #[test]
  fn move_path_rejects_missing_source() {
    let test_root = unique_test_root("grayspace_move_missing_source");
    let destination_dir = test_root.join("destination");
    let missing_source = test_root.join("does-not-exist.txt");

    fs::create_dir_all(&destination_dir).expect("should create destination dir");

    let source = missing_source.to_string_lossy().to_string();
    let destination = destination_dir.to_string_lossy().to_string();
    let result = move_path(&source, &destination);

    assert!(result.is_err());
    assert_eq!(
      result.expect_err("should return an error"),
      "The source path does not exist."
    );

    fs::remove_dir_all(&test_root).expect("should clean up temp root");
  }

  #[test]
  fn import_paths_copies_file_into_destination_folder() {
    let test_root = unique_test_root("grayspace_import_file");
    let source_dir = test_root.join("source");
    let destination_dir = test_root.join("destination");
    let source_file = source_dir.join("notes.txt");

    fs::create_dir_all(&source_dir).expect("should create source dir");
    fs::create_dir_all(&destination_dir).expect("should create destination dir");
    fs::write(&source_file, "hello").expect("should create source file");

    let source = source_file.to_string_lossy().to_string();
    let destination = destination_dir.to_string_lossy().to_string();
    import_paths(vec![source.clone()], &destination).expect("import_paths should copy file");

    assert!(
      source_file.exists(),
      "source file should remain in place after import"
    );
    assert!(
      destination_dir.join("notes.txt").exists(),
      "destination should contain imported file"
    );

    fs::remove_dir_all(&test_root).expect("should clean up temp root");
  }

  #[test]
  fn import_paths_copies_directory_recursively() {
    let test_root = unique_test_root("grayspace_import_dir");
    let source_dir = test_root.join("assets");
    let nested_dir = source_dir.join("nested");
    let destination_dir = test_root.join("destination");

    fs::create_dir_all(&nested_dir).expect("should create nested source dirs");
    fs::create_dir_all(&destination_dir).expect("should create destination dir");
    fs::write(source_dir.join("root.txt"), "root").expect("should create source root file");
    fs::write(nested_dir.join("leaf.txt"), "leaf").expect("should create nested source file");

    let source = source_dir.to_string_lossy().to_string();
    let destination = destination_dir.to_string_lossy().to_string();
    import_paths(vec![source], &destination).expect("import_paths should copy directory");

    let imported_root = destination_dir.join("assets");
    assert!(
      imported_root.exists(),
      "destination should contain imported folder"
    );
    assert!(
      imported_root.join("root.txt").exists(),
      "destination should contain top-level file"
    );
    assert!(
      imported_root.join("nested").join("leaf.txt").exists(),
      "destination should contain nested file"
    );

    fs::remove_dir_all(&test_root).expect("should clean up temp root");
  }

  #[test]
  fn import_paths_rejects_destination_name_collision() {
    let test_root = unique_test_root("grayspace_import_collision");
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
    let result = import_paths(vec![source], &destination);

    assert!(result.is_err());
    assert!(result
      .expect_err("should return an error")
      .contains("already exists in the destination folder"));
    assert!(source_file.exists(), "source file should remain in place");

    fs::remove_dir_all(&test_root).expect("should clean up temp root");
  }

  #[test]
  fn import_paths_rejects_empty_input() {
    let test_root = unique_test_root("grayspace_import_empty");
    fs::create_dir_all(&test_root).expect("should create destination dir");

    let destination = test_root.to_string_lossy().to_string();
    let result = import_paths(Vec::new(), &destination);

    assert!(result.is_err());
    assert_eq!(
      result.expect_err("should return an error"),
      "No paths were provided for import."
    );

    fs::remove_dir_all(&test_root).expect("should clean up temp root");
  }

  #[test]
  fn import_paths_rejects_destination_that_is_not_a_directory() {
    let test_root = unique_test_root("grayspace_import_bad_destination");
    let source_dir = test_root.join("source");
    let source_file = source_dir.join("notes.txt");
    let destination_file = test_root.join("destination.txt");

    fs::create_dir_all(&source_dir).expect("should create source dir");
    fs::write(&source_file, "hello").expect("should create source file");
    fs::write(&destination_file, "not a directory").expect("should create destination file");

    let source = source_file.to_string_lossy().to_string();
    let destination = destination_file.to_string_lossy().to_string();
    let result = import_paths(vec![source], &destination);

    assert!(result.is_err());
    assert_eq!(
      result.expect_err("should return an error"),
      "The destination must be an existing folder."
    );

    fs::remove_dir_all(&test_root).expect("should clean up temp root");
  }

  #[test]
  fn import_paths_rejects_importing_folder_into_descendant() {
    let test_root = unique_test_root("grayspace_import_descendant");
    let source_dir = test_root.join("workspace");
    let nested_destination = source_dir.join("nested");

    fs::create_dir_all(&nested_destination).expect("should create source and nested destination");

    let source = source_dir.to_string_lossy().to_string();
    let destination = nested_destination.to_string_lossy().to_string();
    let result = import_paths(vec![source], &destination);

    assert!(result.is_err());
    assert!(result
      .expect_err("should return an error")
      .contains("Cannot import a folder into itself or one of its descendants."));

    fs::remove_dir_all(&test_root).expect("should clean up temp root");
  }
}
