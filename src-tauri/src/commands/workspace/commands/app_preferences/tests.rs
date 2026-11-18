use super::{read_app_preferences, write_app_preferences, AppPreferences};
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
fn missing_invalid_or_partial_file_shows_hidden_files() {
  let path = unique_test_file("app-preferences-defaults");
  assert!(read_app_preferences(&path).show_hidden_files);

  fs::write(&path, "not json").expect("file should be written");
  assert!(read_app_preferences(&path).show_hidden_files);

  fs::write(&path, "{}").expect("file should be written");
  assert!(read_app_preferences(&path).show_hidden_files);

  fs::remove_file(&path).expect("file should be removed");
}

#[test]
fn app_preferences_round_trip_through_camel_case_file() {
  let path = unique_test_file("app-preferences-round-trip");
  let preferences = AppPreferences { show_hidden_files: false };

  write_app_preferences(&path, &preferences).expect("preferences should be written");
  let raw = fs::read_to_string(&path).expect("file should be read");
  let read_back = read_app_preferences(&path);
  fs::remove_file(&path).expect("file should be removed");

  assert!(raw.contains("\"showHiddenFiles\": false"));
  assert_eq!(read_back, preferences);
}
