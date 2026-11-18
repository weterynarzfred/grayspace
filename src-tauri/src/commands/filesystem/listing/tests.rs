use super::{
  build_directory_page, filter_entries, read_sorted_directory_entries, sort_entries, FsEntry,
  ListingSort,
};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

fn entry(name: &str, is_dir: bool, size_bytes: Option<u64>, modified_ms: Option<u64>) -> FsEntry {
  FsEntry {
    name: name.to_string(),
    path: format!("C:\\root\\{name}"),
    is_dir,
    size_bytes,
    modified_ms,
    is_hidden: false,
  }
}

fn sorted_names(mut entries: Vec<FsEntry>, key: &str, descending: bool) -> Vec<String> {
  sort_entries(&mut entries, ListingSort::from_args(Some(key), Some(descending)));
  entries.into_iter().map(|entry| entry.name).collect()
}

#[test]
fn name_sort_is_natural_case_insensitive_and_folders_first() {
  let entries = vec![
    entry("img10.png", false, Some(1), Some(1)),
    entry("Img2.png", false, Some(1), Some(1)),
    entry("img1.png", false, Some(1), Some(1)),
    entry("b_dir", true, None, Some(1)),
    entry("A_dir", true, None, Some(1)),
  ];

  assert_eq!(
    sorted_names(entries, "name", false),
    vec!["A_dir", "b_dir", "img1.png", "Img2.png", "img10.png"],
  );
}

#[test]
fn descending_sort_keeps_folders_first() {
  let entries = vec![
    entry("a.txt", false, Some(1), Some(1)),
    entry("b.txt", false, Some(1), Some(1)),
    entry("x_dir", true, None, Some(1)),
    entry("y_dir", true, None, Some(1)),
  ];

  assert_eq!(
    sorted_names(entries, "name", true),
    vec!["y_dir", "x_dir", "b.txt", "a.txt"],
  );
}

#[test]
fn size_and_modified_sorts_fall_back_to_name() {
  let entries = vec![
    entry("big.bin", false, Some(500), Some(30)),
    entry("small_b.bin", false, Some(10), Some(10)),
    entry("small_a.bin", false, Some(10), Some(20)),
    entry("dir", true, None, Some(5)),
  ];

  assert_eq!(
    sorted_names(entries.clone(), "size", false),
    vec!["dir", "small_a.bin", "small_b.bin", "big.bin"],
  );
  assert_eq!(
    sorted_names(entries, "modified", true),
    vec!["dir", "big.bin", "small_a.bin", "small_b.bin"],
  );
}

#[test]
fn type_sort_groups_by_lowercase_extension() {
  let entries = vec![
    entry("b.TXT", false, Some(1), Some(1)),
    entry("a.png", false, Some(1), Some(1)),
    entry("noext", false, Some(1), Some(1)),
    entry("a.txt", false, Some(1), Some(1)),
    entry("folder.with.dots", true, None, Some(1)),
  ];

  assert_eq!(
    sorted_names(entries, "type", false),
    vec!["folder.with.dots", "noext", "a.png", "a.txt", "b.TXT"],
  );
}

#[test]
fn filter_matches_names_case_insensitively_and_pages_over_matches() {
  let entries = vec![
    entry("Photos", true, None, Some(1)),
    entry("photo1.JPG", false, Some(1), Some(1)),
    entry("notes.txt", false, Some(1), Some(1)),
    entry("photo2.jpg", false, Some(1), Some(1)),
  ];

  let matches = filter_entries(&entries, "  PHOTO ", true);
  let names: Vec<&str> = matches.iter().map(|entry| entry.name.as_str()).collect();
  assert_eq!(names, vec!["Photos", "photo1.JPG", "photo2.jpg"]);

  let page = build_directory_page(&matches, 2, 2);
  assert_eq!(page.entries.len(), 1);
  assert_eq!(page.total_count, 3);
  assert!(!page.has_more);

  assert_eq!(filter_entries(&entries, "", true).len(), 4);
}

#[test]
fn filter_drops_hidden_entries_unless_shown() {
  let hidden = |name: &str, is_dir: bool| FsEntry { is_hidden: true, ..entry(name, is_dir, None, Some(1)) };
  let entries = vec![
    hidden(".git", true),
    entry("src", true, None, Some(1)),
    hidden("desktop.ini", false),
    entry("notes.txt", false, Some(1), Some(1)),
  ];
  let names = |matches: Vec<&FsEntry>| matches.iter().map(|entry| entry.name.clone()).collect::<Vec<_>>();

  assert_eq!(names(filter_entries(&entries, "", false)), vec!["src", "notes.txt"]);
  assert_eq!(names(filter_entries(&entries, "", true)).len(), 4);
  assert_eq!(names(filter_entries(&entries, "T", false)), vec!["notes.txt"]);
  assert_eq!(names(filter_entries(&entries, "T", true)), vec![".git", "desktop.ini", "notes.txt"]);

  let page = build_directory_page(&filter_entries(&entries, "", false), 0, 1);
  assert_eq!(page.total_count, 2);
  assert!(page.has_more);
}

#[test]
fn unknown_sort_key_falls_back_to_name_ascending() {
  assert_eq!(ListingSort::from_args(Some("bogus"), None), ListingSort::default());
  assert_eq!(ListingSort::from_args(None, None), ListingSort::default());
}

#[test]
fn read_sorted_directory_entries_includes_size_and_modified_time() {
  let unique_id = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("system time should be after unix epoch")
    .as_nanos();
  let test_root = std::env::temp_dir().join(format!("grayspace_listing_meta_{unique_id}"));
  fs::create_dir_all(test_root.join("sub")).expect("should create temp dirs");
  fs::write(test_root.join("five.txt"), "12345").expect("should create five.txt");

  let entries = read_sorted_directory_entries(&test_root.to_string_lossy(), ListingSort::default())
    .expect("listing should succeed");
  fs::remove_dir_all(&test_root).expect("should clean up temp root");

  let folder = &entries[0];
  let file = &entries[1];
  assert_eq!(folder.name, "sub");
  assert_eq!(folder.size_bytes, None);
  assert!(folder.modified_ms.is_some());
  assert_eq!(file.name, "five.txt");
  assert_eq!(file.size_bytes, Some(5));
  assert!(file.modified_ms.is_some());
  assert!(!file.is_hidden);
}
