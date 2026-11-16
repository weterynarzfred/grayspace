use super::{normalize_recent_folder_path, recent_folder_dedupe_key};

#[test]
fn normalize_recent_folder_path_and_dedupe_key_handle_trailing_separators() {
  assert_eq!(
    normalize_recent_folder_path("  C:\\Workspace\\Project\\\\  "),
    "C:\\Workspace\\Project"
  );
  assert_eq!(normalize_recent_folder_path("   "), "");

  #[cfg(target_os = "windows")]
  {
    assert_eq!(normalize_recent_folder_path("C:\\"), "C:\\");
    assert_eq!(
      recent_folder_dedupe_key(" C:/Workspace/Project/ "),
      "c:\\workspace\\project"
    );
  }

  #[cfg(not(target_os = "windows"))]
  {
    assert_eq!(normalize_recent_folder_path("///"), "/");
    assert_eq!(recent_folder_dedupe_key(" /tmp/workspace/project/ "), "/tmp/workspace/project");
  }
}
