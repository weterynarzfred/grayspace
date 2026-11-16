use super::{open_launch_target_in_window, resolve_launch_target, LaunchTarget};
use crate::commands::workspace::model::WorkspaceModel;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn create_launch_root() -> PathBuf {
  let unique_id = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("system time should be after unix epoch")
    .as_nanos();
  let root = std::env::temp_dir().join(format!("grayspace_launch_{unique_id}"));
  fs::create_dir_all(root.join("Photos")).expect("should create Photos");
  fs::write(root.join("Photos").join("cat.jpg"), "").expect("should create cat.jpg");
  root
}

fn args(values: &[&str]) -> Vec<String> {
  values.iter().map(|value| value.to_string()).collect()
}

fn path_string(path: PathBuf) -> String {
  path.to_string_lossy().to_string()
}

#[test]
fn resolve_launch_target_opens_folders_and_selects_files_in_their_folder() {
  let root = create_launch_root();
  let photos = root.join("Photos");

  let folder_target = resolve_launch_target(args(&["--flag", "Photos"]), &root);
  let trailing_separator_target = resolve_launch_target(
    args(&[&format!("{}{}", path_string(photos.clone()), std::path::MAIN_SEPARATOR)]),
    &root,
  );
  let file_target = resolve_launch_target(args(&["Photos/./cat.jpg"]), &root);
  let missing_target = resolve_launch_target(args(&["Nope"]), &root);
  let no_target = resolve_launch_target(args(&[]), &root);
  fs::remove_dir_all(&root).expect("should clean up launch root");

  let expected_folder = LaunchTarget {
    folder: path_string(photos.clone()),
    selected_file: None,
  };
  assert_eq!(folder_target, Some(expected_folder.clone()));
  assert_eq!(trailing_separator_target, Some(expected_folder));
  assert_eq!(file_target, Some(LaunchTarget {
    folder: path_string(photos.clone()),
    selected_file: Some(path_string(photos.join("cat.jpg"))),
  }));
  assert_eq!(missing_target, None);
  assert_eq!(no_target, None);
}

#[test]
fn launch_target_replaces_the_first_window_tab_or_adds_a_tab() {
  let mut model = WorkspaceModel::default();
  let window_id = model.ensure_window_exists_for_label("main");
  let default_tab_id = model.windows[&window_id].active_tab_id.clone();
  let target = LaunchTarget {
    folder: r"C:\Photos".to_string(),
    selected_file: Some(r"C:\Photos\cat.jpg".to_string()),
  };

  open_launch_target_in_window(&mut model, &window_id, &target, true);

  let window = &model.windows[&window_id];
  assert_eq!(window.tab_order.len(), 1);
  assert!(!model.tabs.contains_key(&default_tab_id));
  let launch_tab = &model.tabs[&window.active_tab_id];
  assert_eq!(launch_tab.selected_files.selected_paths, vec![r"C:\Photos\cat.jpg".to_string()]);
  let launch_pane = launch_tab
    .pane_states
    .values()
    .find(|pane| pane.filesystem_state.current_path == r"C:\Photos")
    .expect("a pane should show the launched folder");
  assert_eq!(launch_pane.filesystem_state.selected_paths, vec![r"C:\Photos\cat.jpg".to_string()]);

  let second_target = LaunchTarget {
    folder: r"D:\Music".to_string(),
    selected_file: None,
  };
  open_launch_target_in_window(&mut model, &window_id, &second_target, false);

  let window = &model.windows[&window_id];
  assert_eq!(window.tab_order.len(), 2);
  assert_eq!(window.active_tab_id, window.tab_order[1]);
}
