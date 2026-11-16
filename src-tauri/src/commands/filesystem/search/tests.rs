use super::walk_matching_entries;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::time::{SystemTime, UNIX_EPOCH};

fn create_search_tree() -> PathBuf {
  let unique_id = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("system time should be after unix epoch")
    .as_nanos();
  let root = std::env::temp_dir().join(format!("grayspace_search_{unique_id}"));
  fs::create_dir_all(root.join("sub").join("deeper")).expect("should create nested dirs");
  fs::create_dir_all(root.join("Match_dir")).expect("should create matching dir");
  fs::write(root.join("other.txt"), "").expect("should create other.txt");
  fs::write(root.join("sub").join("match_b.txt"), "").expect("should create match_b.txt");
  fs::write(root.join("sub").join("deeper").join("match_c.txt"), "").expect("should create match_c.txt");
  fs::write(root.join("Match_dir").join("inside.txt"), "").expect("should create inside.txt");
  root
}

fn search_names(root: &PathBuf, query: &str, cancelled: bool, limit: usize) -> Vec<String> {
  let mut names = Vec::new();
  walk_matching_entries(root, query, &AtomicBool::new(cancelled), |entry| {
    names.push(entry.name);
    names.len() < limit
  });
  names
}

#[test]
fn walk_finds_case_insensitive_matches_shallowest_first() {
  let root = create_search_tree();

  let mut names = search_names(&root, " MATCH ", false, usize::MAX);
  fs::remove_dir_all(&root).expect("should clean up search tree");

  assert_eq!(names.pop().as_deref(), Some("match_c.txt"));
  names.sort();
  assert_eq!(names, vec!["Match_dir", "match_b.txt"]);
}

#[test]
fn walk_stops_when_callback_declines_or_search_is_cancelled() {
  let root = create_search_tree();

  let limited = search_names(&root, "match", false, 1);
  let cancelled = search_names(&root, "match", true, usize::MAX);
  fs::remove_dir_all(&root).expect("should clean up search tree");

  assert_eq!(limited.len(), 1);
  assert!(cancelled.is_empty());
}

#[test]
fn existing_paths_keeps_only_paths_still_on_disk() {
  let root = create_search_tree();
  let kept = root.join("other.txt").to_string_lossy().to_string();
  let missing = root.join("gone.txt").to_string_lossy().to_string();

  let existing = super::filesystem_existing_paths(vec![kept.clone(), missing]);
  fs::remove_dir_all(&root).expect("should clean up search tree");

  assert_eq!(existing, vec![kept]);
}
