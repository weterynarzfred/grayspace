use super::types::{
  FilesystemPaneState, LayoutAxis, PaneStateDto, TabLayoutNode, TabSelectedFilesState, TabState,
  WindowBounds, WindowState, WorkspaceSnapshot, DEFAULT_LEFT_PANEL_TYPE, DEFAULT_RIGHT_PANEL_TYPE,
  DEFAULT_SPLIT_RATIO,
};
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

#[derive(Default)]
pub struct WorkspaceState {
  pub(crate) inner: Mutex<WorkspaceModel>,
}

#[derive(Default)]
pub(crate) struct WorkspaceModel {
  pub(crate) revision: u64,
  next_window_id: u64,
  next_tab_id: u64,
  next_terminal_session_id: u64,
  next_pane_id: u64,
  pub(crate) windows: BTreeMap<String, WorkspaceWindow>,
  pub(crate) tabs: BTreeMap<String, WorkspaceTab>,
  pub(crate) window_ids_by_label: HashMap<String, String>,
}

#[derive(Clone)]
pub(crate) struct WorkspaceWindow {
  pub(crate) window_id: String,
  pub(crate) label: String,
  pub(crate) tab_order: Vec<String>,
  pub(crate) active_tab_id: String,
  pub(crate) bounds: WindowBounds,
}

#[derive(Clone)]
pub(crate) struct WorkspaceTab {
  pub(crate) tab_id: String,
  pub(crate) title: String,
  pub(crate) layout: TabLayoutNode,
  pub(crate) pane_states: BTreeMap<String, PaneState>,
  pub(crate) active_pane_id: String,
  pub(crate) selected_files: TabSelectedFilesState,
  pub(crate) terminal_cwd_hint: String,
  pub(crate) workspace_root: Option<String>,
}

#[derive(Clone)]
pub(crate) struct PaneState {
  pub(crate) pane_id: String,
  pub(crate) panel_type: String,
  pub(crate) terminal_session_id: String,
  pub(crate) filesystem_state: FilesystemPaneState,
}

impl WorkspaceModel {
  pub(crate) fn next_window_id(&mut self) -> String {
    self.next_window_id += 1;
    format!("window-{}", self.next_window_id)
  }

  fn next_tab_id(&mut self) -> String {
    self.next_tab_id += 1;
    format!("tab-{}", self.next_tab_id)
  }

  pub(crate) fn next_terminal_session_id(&mut self) -> String {
    self.next_terminal_session_id += 1;
    format!("term-{}", self.next_terminal_session_id)
  }

  pub(crate) fn next_pane_id(&mut self) -> String {
    self.next_pane_id += 1;
    format!("pane-{}", self.next_pane_id)
  }

  pub(crate) fn bump_revision(&mut self) {
    self.revision += 1;
  }

  pub(crate) fn snapshot(&self) -> WorkspaceSnapshot {
    let windows = self
      .windows
      .values()
      .map(|window| WindowState {
        window_id: window.window_id.clone(),
        label: window.label.clone(),
        tab_order: window.tab_order.clone(),
        active_tab_id: window.active_tab_id.clone(),
        bounds: window.bounds.clone(),
      })
      .collect();
    let tabs = self
      .tabs
      .values()
      .map(|tab| TabState {
        tab_id: tab.tab_id.clone(),
        title: tab.title.clone(),
        layout: tab.layout.clone(),
        pane_states: tab
          .pane_states
          .iter()
          .map(|(pane_id, pane_state)| {
            (
              pane_id.clone(),
              PaneStateDto {
                pane_id: pane_state.pane_id.clone(),
                panel_type: pane_state.panel_type.clone(),
                terminal_session_id: pane_state.terminal_session_id.clone(),
                filesystem_state: pane_state.filesystem_state.clone(),
              },
            )
          })
          .collect(),
        active_pane_id: tab.active_pane_id.clone(),
        selected_files: tab.selected_files.clone(),
        terminal_cwd_hint: tab.terminal_cwd_hint.clone(),
        workspace_root: tab.workspace_root.clone(),
      })
      .collect();

    WorkspaceSnapshot {
      revision: self.revision,
      windows,
      tabs,
    }
  }

  pub(crate) fn create_default_tab(&mut self) -> WorkspaceTab {
    let tab_id = self.next_tab_id();
    let left_terminal_session_id = self.next_terminal_session_id();
    let right_terminal_session_id = self.next_terminal_session_id();
    let left_pane_id = format!("{tab_id}-left");
    let right_pane_id = format!("{tab_id}-right");

    let mut pane_states = BTreeMap::new();
    pane_states.insert(
      left_pane_id.clone(),
      PaneState {
        pane_id: left_pane_id.clone(),
        panel_type: DEFAULT_LEFT_PANEL_TYPE.to_string(),
        terminal_session_id: left_terminal_session_id,
        filesystem_state: FilesystemPaneState::default(),
      },
    );
    pane_states.insert(
      right_pane_id.clone(),
      PaneState {
        pane_id: right_pane_id.clone(),
        panel_type: DEFAULT_RIGHT_PANEL_TYPE.to_string(),
        terminal_session_id: right_terminal_session_id,
        filesystem_state: FilesystemPaneState::default(),
      },
    );

    WorkspaceTab {
      tab_id: tab_id.clone(),
      title: format!("Tab {}", tab_id.trim_start_matches("tab-")),
      layout: TabLayoutNode::Split {
        axis: LayoutAxis::Row,
        ratio: DEFAULT_SPLIT_RATIO,
        first: Box::new(TabLayoutNode::Leaf {
          pane_id: left_pane_id.clone(),
        }),
        second: Box::new(TabLayoutNode::Leaf {
          pane_id: right_pane_id,
        }),
      },
      pane_states,
      active_pane_id: left_pane_id,
      selected_files: TabSelectedFilesState::default(),
      terminal_cwd_hint: String::new(),
      workspace_root: None,
    }
  }

  pub(crate) fn create_window_with_new_tab(
    &mut self,
    window_id: String,
    label: String,
    bounds: WindowBounds,
  ) -> String {
    let tab = self.create_default_tab();
    let tab_id = tab.tab_id.clone();
    self.tabs.insert(tab_id.clone(), tab);
    self.create_window_with_existing_tab(window_id, label, bounds, tab_id.clone());
    tab_id
  }

  pub(crate) fn create_window_with_existing_tab(
    &mut self,
    window_id: String,
    label: String,
    bounds: WindowBounds,
    tab_id: String,
  ) {
    let window = WorkspaceWindow {
      window_id: window_id.clone(),
      label: label.clone(),
      tab_order: vec![tab_id.clone()],
      active_tab_id: tab_id,
      bounds,
    };
    self.windows.insert(window_id.clone(), window);
    self.window_ids_by_label.insert(label, window_id);
  }

  pub(crate) fn ensure_window_exists_for_label(&mut self, label: &str) -> String {
    if let Some(existing_window_id) = self.window_ids_by_label.get(label) {
      return existing_window_id.clone();
    }

    let window_id = self.next_window_id();
    self.create_window_with_new_tab(
      window_id.clone(),
      label.to_string(),
      WindowBounds::default(),
    );
    self.bump_revision();
    window_id
  }

  pub(crate) fn remove_window(&mut self, window_id: &str) -> Option<WorkspaceWindow> {
    let removed = self.windows.remove(window_id)?;
    self.window_ids_by_label.remove(&removed.label);
    Some(removed)
  }

  pub(crate) fn close_window_and_collect_terminal_sessions(
    &mut self,
    window_id: &str,
  ) -> Option<(String, Vec<String>)> {
    let window = self.remove_window(window_id)?;
    let mut session_ids = Vec::new();

    for tab_id in &window.tab_order {
      if let Some(tab) = self.tabs.remove(tab_id) {
        session_ids.extend(
          tab
            .pane_states
            .values()
            .map(|pane_state| pane_state.terminal_session_id.clone()),
        );
      }
    }

    self.bump_revision();
    Some((window.label, session_ids))
  }

  pub(crate) fn ensure_window_has_active_tab(&mut self, window_id: &str) {
    let Some(window) = self.windows.get_mut(window_id) else {
      return;
    };

    if window.tab_order.is_empty() {
      window.active_tab_id.clear();
      return;
    }

    if !window
      .tab_order
      .iter()
      .any(|tab_id| tab_id == &window.active_tab_id)
    {
      window.active_tab_id = window.tab_order[0].clone();
    }
  }

  pub(crate) fn close_window_if_empty_or_fix_active(&mut self, window_id: &str) -> Option<String> {
    let should_close = self
      .windows
      .get(window_id)
      .map(|window| window.tab_order.is_empty())
      .unwrap_or(false);
    if should_close {
      self.remove_window(window_id).map(|window| window.label)
    } else {
      self.ensure_window_has_active_tab(window_id);
      None
    }
  }
}

#[cfg(test)]
mod tests {
  use super::WorkspaceModel;
  use crate::commands::workspace::types::{LayoutAxis, TabLayoutNode};

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
}
