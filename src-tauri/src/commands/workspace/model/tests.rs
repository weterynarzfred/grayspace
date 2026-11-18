use super::WorkspaceModel;
use crate::commands::workspace::types::{LayoutAxis, TabLayoutNode, WindowBounds};

fn find_first_layout_pane_id(layout: &TabLayoutNode) -> Option<String> {
  match layout {
    TabLayoutNode::Leaf { pane_id } => Some(pane_id.clone()),
    TabLayoutNode::Split { first, .. } => find_first_layout_pane_id(first),
  }
}

#[test]
fn ensure_window_bootstrap_creates_default_tab() {
  let mut model = WorkspaceModel::default();
  let window_id = model.ensure_window_exists_for_label("main");
  let window = model.windows.get(&window_id).expect("window should exist");
  assert_eq!(window.tab_order.len(), 1);
  assert_eq!(window.active_tab_id, window.tab_order[0]);
  assert_eq!(model.tabs.len(), 1);

  let tab = model
    .tabs
    .get(&window.active_tab_id)
    .expect("default tab should exist");
  assert_eq!(tab.workspace_root, None);
  assert_eq!(tab.pane_states.len(), 2);
  assert_eq!(
    tab.active_pane_id,
    find_first_layout_pane_id(&tab.layout).expect("layout should contain at least one pane"),
  );

  match &tab.layout {
    TabLayoutNode::Split {
      axis,
      ratio,
      first,
      second,
    } => {
      assert_eq!(*axis, LayoutAxis::Row);
      assert_eq!(*ratio, 50);
      assert!(matches!(&**first, TabLayoutNode::Leaf { .. }));
      assert!(matches!(&**second, TabLayoutNode::Leaf { .. }));
    }
    _ => panic!("default tab should use split layout"),
  }

  let active_pane = tab
    .pane_states
    .get(&tab.active_pane_id)
    .expect("active pane should exist");
  assert_eq!(active_pane.filesystem_state.current_drive, "");
  assert_eq!(active_pane.filesystem_state.current_path, "");
  assert!(active_pane.filesystem_state.selected_paths.is_empty());
  assert_eq!(active_pane.filesystem_state.scroll_top, 0.0);
  assert_eq!(active_pane.filesystem_state.thumbnail_size_px, 22);

  assert!(tab.selected_files.selected_paths.is_empty());
}

#[test]
fn close_window_collects_terminal_sessions() {
  let mut model = WorkspaceModel::default();
  let window_id = model.ensure_window_exists_for_label("main");
  let (_, session_ids) = model
    .close_window_and_collect_terminal_sessions(&window_id)
    .expect("window should close");

  assert_eq!(session_ids.len(), 2);
  assert!(model.windows.is_empty());
  assert!(model.tabs.is_empty());
}

#[test]
fn ensure_window_exists_for_label_is_idempotent() {
  let mut model = WorkspaceModel::default();
  let initial_window_id = model.ensure_window_exists_for_label("main");
  let revision_after_first_call = model.revision;

  let second_window_id = model.ensure_window_exists_for_label("main");

  assert_eq!(second_window_id, initial_window_id);
  assert_eq!(
    model.revision, revision_after_first_call,
    "revision should not change when reusing existing label"
  );
  assert_eq!(model.windows.len(), 1);
  assert_eq!(model.tabs.len(), 1);
}

#[test]
fn ensure_window_has_active_tab_sets_first_tab_when_active_is_invalid() {
  let mut model = WorkspaceModel::default();
  let window_id = model.ensure_window_exists_for_label("main");
  let initial_tab_id = model
    .windows
    .get(&window_id)
    .expect("window should exist")
    .tab_order[0]
    .clone();

  let second_tab = model.create_default_tab();
  let second_tab_id = second_tab.tab_id.clone();
  model.tabs.insert(second_tab_id.clone(), second_tab);

  {
    let window = model
      .windows
      .get_mut(&window_id)
      .expect("window should still exist");
    window.tab_order.push(second_tab_id);
    window.active_tab_id = "tab-missing".to_string();
  }

  model.ensure_window_has_active_tab(&window_id);

  let window = model.windows.get(&window_id).expect("window should exist");
  assert_eq!(window.active_tab_id, initial_tab_id);
}

#[test]
fn close_window_if_empty_or_fix_active_closes_empty_window() {
  let mut model = WorkspaceModel::default();
  let window_id = model.ensure_window_exists_for_label("main");
  let tab_id = model
    .windows
    .get(&window_id)
    .expect("window should exist")
    .tab_order[0]
    .clone();

  model.tabs.remove(&tab_id);
  {
    let window = model
      .windows
      .get_mut(&window_id)
      .expect("window should still exist");
    window.tab_order.clear();
    window.active_tab_id = "tab-missing".to_string();
  }

  let maybe_closed_label = model.close_window_if_empty_or_fix_active(&window_id);

  assert_eq!(maybe_closed_label.as_deref(), Some("main"));
  assert!(!model.windows.contains_key(&window_id));
  assert_eq!(model.window_ids_by_label.get("main"), None);
}

#[test]
fn close_window_if_empty_or_fix_active_repairs_invalid_active_tab() {
  let mut model = WorkspaceModel::default();
  let window_id = model.ensure_window_exists_for_label("main");
  let first_tab_id = model
    .windows
    .get(&window_id)
    .expect("window should exist")
    .tab_order[0]
    .clone();

  {
    let window = model
      .windows
      .get_mut(&window_id)
      .expect("window should exist");
    window.active_tab_id = "tab-not-in-window".to_string();
  }

  let maybe_closed_label = model.close_window_if_empty_or_fix_active(&window_id);

  assert_eq!(maybe_closed_label, None);
  let window = model
    .windows
    .get(&window_id)
    .expect("window should still exist");
  assert_eq!(window.active_tab_id, first_tab_id);
}

#[test]
fn window_created_with_bounds_saves_them() {
  let mut model = WorkspaceModel::default();
  let bounds = WindowBounds { x: 10, y: 20, width: 900, height: 700, maximized: true };
  model.create_window_with_new_tab("window-1".to_string(), "main".to_string(), bounds.clone());

  assert_eq!(model.windows["window-1"].saved_bounds(), bounds);
}

#[test]
fn set_bounds_keeps_the_normal_rect_while_maximized() {
  let mut model = WorkspaceModel::default();
  let window_id = model.ensure_window_exists_for_label("main");
  let window = model.windows.get_mut(&window_id).expect("window should exist");

  let normal = WindowBounds { x: 10, y: 20, width: 900, height: 700, maximized: false };
  window.set_bounds(normal.clone());
  assert_eq!(window.saved_bounds(), normal);

  let maximized = WindowBounds { x: 0, y: 0, width: 1920, height: 1040, maximized: true };
  window.set_bounds(maximized.clone());
  assert_eq!(window.bounds, maximized);
  assert_eq!(window.saved_bounds(), WindowBounds { maximized: true, ..normal });
}

#[test]
fn set_bounds_moves_the_normal_rect_to_the_monitor_maximized_on() {
  let mut model = WorkspaceModel::default();
  let window_id = model.ensure_window_exists_for_label("main");
  let window = model.windows.get_mut(&window_id).expect("window should exist");

  window.set_bounds(WindowBounds { x: 100, y: 20, width: 1600, height: 900, maximized: false });
  window.set_bounds(WindowBounds { x: 1920, y: 0, width: 1280, height: 1000, maximized: true });

  assert_eq!(
    window.saved_bounds(),
    WindowBounds { x: 1920, y: 50, width: 1280, height: 900, maximized: true },
  );
}

#[test]
fn minimized_report_only_sets_the_flag() {
  let mut model = WorkspaceModel::default();
  let window_id = model.ensure_window_exists_for_label("main");
  let maximized = WindowBounds { x: 0, y: 0, width: 1920, height: 1040, maximized: true };
  // How Windows reports a minimized window, even one that was maximized.
  let offscreen = WindowBounds { x: -32000, y: -32000, width: 160, height: 28, maximized: false };

  let window = model.windows.get_mut(&window_id).expect("window should exist");
  assert!(window.apply_bounds_report(maximized.clone(), false));
  let saved = window.saved_bounds();

  assert!(window.apply_bounds_report(offscreen.clone(), true));
  assert!(!window.apply_bounds_report(offscreen, true));
  assert_eq!(window.bounds, maximized);
  assert_eq!(window.saved_bounds(), saved);
  assert!(model.snapshot().windows[0].minimized);

  let window = model.windows.get_mut(&window_id).expect("window should exist");
  assert!(
    window.apply_bounds_report(maximized.clone(), false),
    "restoring to the same rect should clear the flag",
  );
  assert!(!window.apply_bounds_report(maximized, false));
  assert!(!model.snapshot().windows[0].minimized);
}
