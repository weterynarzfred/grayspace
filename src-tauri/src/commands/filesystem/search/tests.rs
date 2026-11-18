use super::{walk_matching_entries, SearchCriteria, SearchOptions};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_root(prefix: &str) -> PathBuf {
  let unique_id = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("system time should be after unix epoch")
    .as_nanos();
  std::env::temp_dir().join(format!("{prefix}_{unique_id}"))
}

fn create_search_tree() -> PathBuf {
  let root = unique_root("grayspace_search");
  fs::create_dir_all(root.join("sub").join("deeper")).expect("should create nested dirs");
  fs::create_dir_all(root.join("Match_dir")).expect("should create matching dir");
  fs::write(root.join("other.txt"), "").expect("should create other.txt");
  fs::write(root.join("sub").join("match_b.txt"), "").expect("should create match_b.txt");
  fs::write(root.join("sub").join("deeper").join("match_c.txt"), "").expect("should create match_c.txt");
  fs::write(root.join("Match_dir").join("inside.txt"), "").expect("should create inside.txt");
  root
}

/// node_modules/{match_skipped.txt, pkg/node_modules/match_nested.txt}, sub/.GIT/match_skipped.txt,
/// sub/match_kept.txt and target/{CACHEDIR.TAG, match_cached.txt}.
fn create_skip_tree() -> PathBuf {
  let root = unique_root("grayspace_search_skip");
  let nested_modules = root.join("node_modules").join("pkg").join("node_modules");
  fs::create_dir_all(&nested_modules).expect("should create nested node_modules");
  fs::create_dir_all(root.join("sub").join(".GIT")).expect("should create .GIT");
  fs::create_dir_all(root.join("target")).expect("should create target");
  fs::write(root.join("node_modules").join("match_skipped.txt"), "").expect("should create file");
  fs::write(nested_modules.join("match_nested.txt"), "").expect("should create file");
  fs::write(root.join("sub").join(".GIT").join("match_skipped.txt"), "").expect("should create file");
  fs::write(root.join("sub").join("match_kept.txt"), "").expect("should create file");
  fs::write(root.join("target").join("CACHEDIR.TAG"), "Signature: 8a477f597d28d172789f06886806bc55")
    .expect("should create CACHEDIR.TAG");
  fs::write(root.join("target").join("match_cached.txt"), "").expect("should create file");
  root
}

/// .match_hidden_dir/match_inside.txt, .match_hidden.txt and match_visible.txt. Windows only
/// counts the Hidden attribute, so the dot-names get it there too.
fn create_hidden_tree() -> PathBuf {
  let root = unique_root("grayspace_search_hidden");
  let hidden_dir = root.join(".match_hidden_dir");
  let hidden_file = root.join(".match_hidden.txt");
  fs::create_dir_all(&hidden_dir).expect("should create hidden dir");
  fs::write(hidden_dir.join("match_inside.txt"), "").expect("should create file");
  fs::write(&hidden_file, "").expect("should create file");
  fs::write(root.join("match_visible.txt"), "").expect("should create file");
  #[cfg(target_os = "windows")]
  for hidden_path in [&hidden_dir, &hidden_file] {
    let status = std::process::Command::new("attrib")
      .arg("+h")
      .arg(hidden_path)
      .status()
      .expect("attrib should run");
    assert!(status.success(), "attrib +h should succeed");
  }
  root
}

fn skip_options(names: &[&str]) -> SearchOptions {
  SearchOptions {
    skip_folder_names: names.iter().map(|name| name.to_string()).collect(),
    ..SearchOptions::default()
  }
}

fn regex_options() -> SearchOptions {
  SearchOptions { use_regex: true, ..SearchOptions::default() }
}

fn walk_names(root: &Path, query: &str, options: SearchOptions, cancelled: bool, limit: usize) -> Vec<String> {
  let criteria = SearchCriteria::new(query, options).expect("search criteria should be valid");
  let mut names = Vec::new();
  walk_matching_entries(root, &criteria, &AtomicBool::new(cancelled), |entry| {
    names.push(entry.name);
    names.len() < limit
  });
  names
}

fn sorted_names(root: &Path, query: &str, options: SearchOptions) -> Vec<String> {
  let mut names = walk_names(root, query, options, false, usize::MAX);
  names.sort();
  names
}

#[test]
fn walk_finds_case_insensitive_matches_shallowest_first() {
  let root = create_search_tree();

  let mut names = walk_names(&root, " MATCH ", SearchOptions::default(), false, usize::MAX);
  fs::remove_dir_all(&root).expect("should clean up search tree");

  assert_eq!(names.pop().as_deref(), Some("match_c.txt"));
  names.sort();
  assert_eq!(names, vec!["Match_dir", "match_b.txt"]);
}

#[test]
fn walk_stops_when_callback_declines_or_search_is_cancelled() {
  let root = create_search_tree();

  let limited = walk_names(&root, "match", SearchOptions::default(), false, 1);
  let cancelled = walk_names(&root, "match", SearchOptions::default(), true, usize::MAX);
  fs::remove_dir_all(&root).expect("should clean up search tree");

  assert_eq!(limited.len(), 1);
  assert!(cancelled.is_empty());
}

#[test]
fn walk_lists_skipped_folders_case_insensitively_without_descending() {
  let root = create_skip_tree();

  let matches = sorted_names(&root, "match", skip_options(&["NODE_MODULES", ".git"]));
  let skipped_folder = sorted_names(&root, "node_modules", skip_options(&["node_modules"]));
  let skipped_git = sorted_names(&root, ".git", skip_options(&[".git"]));
  fs::remove_dir_all(&root).expect("should clean up search tree");

  assert_eq!(matches, vec!["match_cached.txt", "match_kept.txt"]);
  assert_eq!(skipped_folder, vec!["node_modules"]);
  assert_eq!(skipped_git, vec![".GIT"]);
}

#[test]
fn walk_searches_a_skipped_root_but_not_skipped_folders_inside_it() {
  let root = create_skip_tree();

  let names = sorted_names(&root.join("node_modules"), "match", skip_options(&["node_modules"]));
  fs::remove_dir_all(&root).expect("should clean up search tree");

  assert_eq!(names, vec!["match_skipped.txt"]);
}

#[test]
fn walk_descends_everywhere_with_an_empty_skip_list() {
  let root = create_skip_tree();

  let names = sorted_names(&root, "match", SearchOptions::default());
  fs::remove_dir_all(&root).expect("should clean up search tree");

  assert_eq!(names, vec![
    "match_cached.txt",
    "match_kept.txt",
    "match_nested.txt",
    "match_skipped.txt",
    "match_skipped.txt",
  ]);
}

#[test]
fn walk_skips_cache_dir_tagged_folders_only_when_asked() {
  let root = create_skip_tree();
  let cache_dir_options = || SearchOptions { skip_cache_dir_tagged: true, ..skip_options(&["node_modules", ".git"]) };

  let without_option = sorted_names(&root, "match_cached", skip_options(&["node_modules", ".git"]));
  let with_option = sorted_names(&root, "match_cached", cache_dir_options());
  let tagged_folder = sorted_names(&root, "target", cache_dir_options());
  fs::remove_dir_all(&root).expect("should clean up search tree");

  assert_eq!(without_option, vec!["match_cached.txt"]);
  assert!(with_option.is_empty());
  assert_eq!(tagged_folder, vec!["target"]);
}

#[test]
fn walk_skips_hidden_entries_and_their_contents_only_when_asked() {
  let root = create_hidden_tree();
  let skip_hidden = || SearchOptions { skip_hidden: true, ..SearchOptions::default() };

  let shown = sorted_names(&root, "match", SearchOptions::default());
  let skipped = sorted_names(&root, "match", skip_hidden());
  let from_hidden_root = sorted_names(&root.join(".match_hidden_dir"), "match", skip_hidden());
  fs::remove_dir_all(&root).expect("should clean up search tree");

  assert_eq!(shown, vec![".match_hidden.txt", ".match_hidden_dir", "match_inside.txt", "match_visible.txt"]);
  assert_eq!(skipped, vec!["match_visible.txt"]);
  assert_eq!(from_hidden_root, vec!["match_inside.txt"]);
}

#[test]
fn regex_matches_the_path_relative_to_the_root_with_forward_slashes() {
  let root = create_search_tree();

  let nested = sorted_names(&root, "^sub/deeper/", regex_options());
  let case_insensitive = sorted_names(&root, "^SUB/MATCH_B\\.txt$", regex_options());
  let folder_without_trailing_slash = sorted_names(&root, "^match_dir$", regex_options());
  let unanchored = sorted_names(&root, "deeper", regex_options());
  fs::remove_dir_all(&root).expect("should clean up search tree");

  assert_eq!(nested, vec!["match_c.txt"]);
  assert_eq!(case_insensitive, vec!["match_b.txt"]);
  assert_eq!(folder_without_trailing_slash, vec!["Match_dir"]);
  assert_eq!(unanchored, vec!["deeper", "match_c.txt"]);
}

#[test]
fn invalid_regex_is_rejected_with_a_short_reason() {
  let Err(error) = SearchCriteria::new("match(", regex_options()) else {
    panic!("an unclosed group should be rejected");
  };

  assert_eq!(error, "Invalid regex: unclosed group");
  assert!(SearchCriteria::new("match(", SearchOptions::default()).is_ok());
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
