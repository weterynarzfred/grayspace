use super::{
  escape_single_quotes, maybe_existing_dir, normalize_terminal_command, path_for_shell,
  shell_command_path, terminal_size,
};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_test_dir(prefix: &str) -> std::path::PathBuf {
  let unique_id = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("system time should be after unix epoch")
    .as_nanos();
  std::env::temp_dir().join(format!("{prefix}_{unique_id}"))
}

#[test]
fn terminal_size_clamps_to_minimum_dimensions() {
  let small = terminal_size(0, 0);
  assert_eq!(small.cols, 2);
  assert_eq!(small.rows, 1);

  let normal = terminal_size(120, 40);
  assert_eq!(normal.cols, 120);
  assert_eq!(normal.rows, 40);
}

#[test]
fn escape_single_quotes_handles_embedded_quotes() {
  assert_eq!(escape_single_quotes("plain"), "plain");
  assert_eq!(escape_single_quotes("a'b'c"), "a'\\''b'\\''c");
}

#[test]
fn normalize_terminal_command_appends_newline_when_missing() {
  assert_eq!(
    normalize_terminal_command("npm test".to_string()).expect("command should normalize"),
    "npm test\n"
  );
  assert_eq!(
    normalize_terminal_command("npm test\n".to_string()).expect("command should normalize"),
    "npm test\n"
  );
}

#[test]
fn normalize_terminal_command_rejects_empty_commands() {
  let error =
    normalize_terminal_command("   ".to_string()).expect_err("empty command should be rejected");
  assert_eq!(error, "Terminal command cannot be empty.");
}

#[test]
fn maybe_existing_dir_accepts_only_existing_directories() {
  let root = unique_test_dir("grayspace_terminal_existing_dir");
  fs::create_dir_all(&root).expect("should create root");
  let nested_dir = root.join("nested");
  fs::create_dir_all(&nested_dir).expect("should create nested dir");
  let file_path = root.join("file.txt");
  fs::write(&file_path, "hello").expect("should create file");

  let nested_dir_string = nested_dir.to_string_lossy().to_string();
  let file_path_string = file_path.to_string_lossy().to_string();
  let missing_string = root.join("missing").to_string_lossy().to_string();

  assert_eq!(
    maybe_existing_dir(Some(nested_dir_string)),
    Some(nested_dir)
  );
  assert_eq!(maybe_existing_dir(Some(file_path_string)), None);
  assert_eq!(maybe_existing_dir(Some(missing_string)), None);
  assert_eq!(maybe_existing_dir(None), None);

  fs::remove_dir_all(&root).expect("should clean up root");
}

#[cfg(target_os = "windows")]
#[test]
fn path_for_shell_converts_windows_drive_paths() {
  assert_eq!(
    path_for_shell(Path::new(r"C:\Users\alice\project")),
    "/c/Users/alice/project"
  );
  assert_eq!(path_for_shell(Path::new(r"D:\")), "/d");
}

#[cfg(not(target_os = "windows"))]
#[test]
fn path_for_shell_keeps_unix_paths() {
  assert_eq!(path_for_shell(Path::new("/tmp/work")), "/tmp/work");
}

#[cfg(target_os = "windows")]
#[test]
fn shell_command_path_is_git_bash_on_windows() {
  assert_eq!(shell_command_path(), r"C:\Program Files\Git\bin\bash.exe");
}

#[cfg(not(target_os = "windows"))]
#[test]
fn shell_command_path_is_bin_bash_on_unix() {
  assert_eq!(shell_command_path(), "/bin/bash");
}
