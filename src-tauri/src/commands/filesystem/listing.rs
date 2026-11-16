use super::system_time_to_epoch_millis;
use serde::Serialize;
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

#[derive(Clone, Serialize)]
pub struct FsEntry {
  pub(super) name: String,
  pub(super) path: String,
  pub(super) is_dir: bool,
  pub(super) size_bytes: Option<u64>,
  pub(super) modified_ms: Option<u64>,
  pub(super) is_hidden: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsDirectoryPage {
  pub(super) entries: Vec<FsEntry>,
  pub(super) has_more: bool,
  pub(super) total_count: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
enum SortKey {
  #[default]
  Name,
  Modified,
  Size,
  Type,
}

/// Folders always come first; `descending` flips the order inside each group.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct ListingSort {
  key: SortKey,
  descending: bool,
}

impl ListingSort {
  pub(super) fn from_args(key: Option<&str>, descending: Option<bool>) -> Self {
    let key = match key {
      Some("modified") => SortKey::Modified,
      Some("size") => SortKey::Size,
      Some("type") => SortKey::Type,
      _ => SortKey::Name,
    };
    Self {
      key,
      descending: descending.unwrap_or(false),
    }
  }
}

struct CachedListing {
  sort: ListingSort,
  entries: Vec<FsEntry>,
}

#[derive(Default)]
pub struct FilesystemDirectoryListingState {
  listings: Mutex<HashMap<String, CachedListing>>,
}

/// Digit runs compare by numeric value, so "img2" sorts before "img10".
#[derive(PartialEq, Eq, PartialOrd, Ord)]
enum NameChunk {
  Number { digit_count: usize, digits: String },
  Text(String),
}

fn natural_name_key(name: &str) -> Vec<NameChunk> {
  let lowercase_name = name.to_lowercase();
  let mut chunks = Vec::new();
  let mut rest = lowercase_name.as_str();
  while let Some(first_char) = rest.chars().next() {
    let is_number = first_char.is_ascii_digit();
    let chunk_end = rest
      .find(|character: char| character.is_ascii_digit() != is_number)
      .unwrap_or(rest.len());
    let (chunk, tail) = rest.split_at(chunk_end);
    chunks.push(if is_number {
      let digits = chunk.trim_start_matches('0').to_string();
      NameChunk::Number { digit_count: digits.len(), digits }
    } else {
      NameChunk::Text(chunk.to_string())
    });
    rest = tail;
  }
  chunks
}

fn file_extension(entry: &FsEntry) -> String {
  if entry.is_dir {
    return String::new();
  }
  Path::new(&entry.name)
    .extension()
    .map(|extension| extension.to_string_lossy().to_lowercase())
    .unwrap_or_default()
}

fn entry_sort_key(entry: &FsEntry, key: SortKey) -> (Option<u64>, String, Vec<NameChunk>) {
  let number = match key {
    SortKey::Modified => entry.modified_ms,
    SortKey::Size => entry.size_bytes,
    SortKey::Name | SortKey::Type => None,
  };
  let text = if key == SortKey::Type { file_extension(entry) } else { String::new() };
  (number, text, natural_name_key(&entry.name))
}

pub(super) fn sort_entries(entries: &mut [FsEntry], sort: ListingSort) {
  entries.sort_by_cached_key(|entry| entry_sort_key(entry, sort.key));
  if sort.descending {
    entries.reverse();
  }
  entries.sort_by_key(|entry| !entry.is_dir);
}

#[cfg(target_os = "windows")]
fn is_hidden_entry(_name: &str, metadata: &fs::Metadata) -> bool {
  use std::os::windows::fs::MetadataExt;
  const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
  metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg(not(target_os = "windows"))]
fn is_hidden_entry(name: &str, _metadata: &fs::Metadata) -> bool {
  name.starts_with('.')
}

pub(super) fn read_fs_entry(dir_entry: &fs::DirEntry) -> Result<FsEntry, String> {
  let name = dir_entry.file_name().to_string_lossy().to_string();
  let is_dir = dir_entry
    .file_type()
    .map_err(|error| error.to_string())?
    .is_dir();
  let metadata = dir_entry.metadata().ok();

  Ok(FsEntry {
    path: dir_entry.path().to_string_lossy().to_string(),
    is_dir,
    size_bytes: metadata.as_ref().filter(|_| !is_dir).map(fs::Metadata::len),
    modified_ms: metadata.as_ref().and_then(|metadata| system_time_to_epoch_millis(metadata.modified())),
    is_hidden: metadata.as_ref().is_some_and(|metadata| is_hidden_entry(&name, metadata)),
    name,
  })
}

pub(super) fn read_sorted_directory_entries(path: &str, sort: ListingSort) -> Result<Vec<FsEntry>, String> {
  let mut entries = Vec::new();
  let read_dir = fs::read_dir(path).map_err(|error| error.to_string())?;
  for entry_result in read_dir {
    let dir_entry = entry_result.map_err(|error| error.to_string())?;
    entries.push(read_fs_entry(&dir_entry)?);
  }

  sort_entries(&mut entries, sort);
  Ok(entries)
}

/// Case-insensitive substring match on the entry name; a blank filter matches everything.
pub(super) fn filter_entries<'a>(entries: &'a [FsEntry], filter: &str) -> Vec<&'a FsEntry> {
  let needle = filter.trim().to_lowercase();
  entries
    .iter()
    .filter(|entry| needle.is_empty() || entry.name.to_lowercase().contains(&needle))
    .collect()
}

pub(super) fn build_directory_page(entries: &[&FsEntry], offset: usize, limit: usize) -> FsDirectoryPage {
  let normalized_limit = limit.clamp(1, 1024);
  let start = offset.min(entries.len());
  let end = (start + normalized_limit).min(entries.len());

  FsDirectoryPage {
    entries: entries[start..end].iter().map(|entry| (*entry).clone()).collect(),
    has_more: end < entries.len(),
    total_count: entries.len(),
  }
}

#[tauri::command]
pub fn list_directory(
  path: &str,
  sort_key: Option<String>,
  sort_descending: Option<bool>,
) -> Result<Vec<FsEntry>, String> {
  read_sorted_directory_entries(path, ListingSort::from_args(sort_key.as_deref(), sort_descending))
}

#[tauri::command]
pub fn list_directory_page(
  state: State<FilesystemDirectoryListingState>,
  path: &str,
  offset: usize,
  limit: usize,
  refresh: Option<bool>,
  sort_key: Option<String>,
  sort_descending: Option<bool>,
  filter: Option<String>,
) -> Result<FsDirectoryPage, String> {
  let normalized_path = path.trim();
  if normalized_path.is_empty() {
    return Err("A path is required.".to_string());
  }

  let sort = ListingSort::from_args(sort_key.as_deref(), sort_descending);
  let mut listings = state
    .listings
    .lock()
    .map_err(|_| "Failed to access directory listing cache.".to_string())?;

  if refresh.unwrap_or(false) {
    listings.remove(normalized_path);
  }

  let listing = match listings.entry(normalized_path.to_string()) {
    Entry::Occupied(entry) => entry.into_mut(),
    Entry::Vacant(entry) => entry.insert(CachedListing {
      sort,
      entries: read_sorted_directory_entries(normalized_path, sort)?,
    }),
  };
  if listing.sort != sort {
    sort_entries(&mut listing.entries, sort);
    listing.sort = sort;
  }

  let visible_entries = filter_entries(&listing.entries, filter.as_deref().unwrap_or(""));
  Ok(build_directory_page(&visible_entries, offset, limit))
}

#[cfg(test)]
mod tests;
