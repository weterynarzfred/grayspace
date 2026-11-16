use super::{folder_view_style_key, read_folder_view_styles, write_folder_view_styles, FolderViewStyle};
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{env, fs};

fn unique_test_file(prefix: &str) -> std::path::PathBuf {
  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("clock should be monotonic")
    .as_nanos();
  env::temp_dir().join(format!("{prefix}-{timestamp}.json"))
}

#[test]
fn folder_view_style_key_ignores_blank_paths_and_trailing_separators() {
  assert_eq!(folder_view_style_key("   "), None);

  #[cfg(target_os = "windows")]
  assert_eq!(
    folder_view_style_key("C:/Photos/Trip/"),
    Some("c:\\photos\\trip".to_string())
  );

  #[cfg(not(target_os = "windows"))]
  assert_eq!(folder_view_style_key("/photos/trip/"), Some("/photos/trip".to_string()));
}

#[test]
fn read_folder_view_styles_returns_empty_map_for_missing_or_invalid_file() {
  let path = unique_test_file("folder-view-styles-missing");
  assert!(read_folder_view_styles(&path).is_empty());

  fs::write(&path, "not json").expect("file should be written");
  assert!(read_folder_view_styles(&path).is_empty());

  fs::remove_file(&path).expect("file should be removed");
}

#[test]
fn folder_view_styles_round_trip_through_file() {
  let path = unique_test_file("folder-view-styles-round-trip");
  let mut styles = BTreeMap::new();
  styles.insert(
    "c:\\photos".to_string(),
    FolderViewStyle {
      view_type: "details".to_string(),
      thumbnail_size_px: 128,
      sort_key: "modified".to_string(),
      sort_descending: true,
    },
  );

  write_folder_view_styles(&path, &styles).expect("styles should be written");
  assert_eq!(read_folder_view_styles(&path), styles);

  fs::remove_file(&path).expect("file should be removed");
}

#[test]
fn folder_view_styles_saved_before_sorting_default_to_name_ascending() {
  let path = unique_test_file("folder-view-styles-legacy");
  fs::write(&path, r#"{"c:\\photos":{"viewType":"grid","thumbnailSizePx":64}}"#)
    .expect("file should be written");

  let styles = read_folder_view_styles(&path);
  fs::remove_file(&path).expect("file should be removed");

  let style = styles.get("c:\\photos").expect("legacy style should be read");
  assert_eq!(style.sort_key, "name");
  assert!(!style.sort_descending);
}
