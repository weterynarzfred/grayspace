use super::{validate_target, ShellMenuTarget};

fn items(paths: &[&str]) -> ShellMenuTarget {
  ShellMenuTarget::Items {
    paths: paths.iter().map(|path| path.to_string()).collect(),
  }
}

#[test]
fn shell_menu_accepts_items_of_one_folder_and_any_background() {
  assert!(validate_target(&items(&["C:\\photos\\a.jpg", "C:\\photos\\b"])).is_ok());
  assert!(validate_target(&items(&["C:\\", "D:\\"])).is_ok());
  assert!(validate_target(&ShellMenuTarget::Background { folder: "C:\\photos".into() }).is_ok());
}

#[test]
fn shell_menu_rejects_empty_and_mixed_folder_items() {
  assert_eq!(
    validate_target(&items(&[])),
    Err("No items were provided for the Windows menu.".into())
  );
  assert_eq!(
    validate_target(&items(&["C:\\photos\\a.jpg", "C:\\photos\\2024\\b.jpg"])),
    Err("The Windows menu can only show items from one folder.".into())
  );
}

#[test]
fn shell_menu_target_reads_the_js_shape() {
  let target: ShellMenuTarget = serde_json::from_str(r#"{"kind":"background","folder":"C:\\photos"}"#).unwrap();
  assert!(matches!(target, ShellMenuTarget::Background { folder } if folder == "C:\\photos"));
  let target: ShellMenuTarget = serde_json::from_str(r#"{"kind":"items","paths":["C:\\a.txt"]}"#).unwrap();
  assert!(matches!(target, ShellMenuTarget::Items { paths } if paths == ["C:\\a.txt"]));
}
