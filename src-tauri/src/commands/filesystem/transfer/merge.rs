use super::replace::{replace_item, Transfer};
use super::{copy_path_recursive, is_real_dir, move_whole, path_error, MoveStep, TransferProgress};
use serde::Serialize;
use std::fs;
use std::path::Path;

/// What a merging move did, for undo: the items it moved, each one whole, and the source folders
/// it left empty and removed, deepest first.
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRecord {
  moved_items: Vec<MovedItem>,
  removed_folders: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MovedItem {
  source_path: String,
  destination_path: String,
}

/// Both are real folders, so Replace merges them. A link (symlink, junction) counts as a file and
/// is replaced, so a merge never follows one and never writes outside the destination tree.
pub(super) fn is_folder_merge(source_path: &Path, destination_path: &Path) -> bool {
  is_real_dir(source_path) && is_real_dir(destination_path)
}

/// Copies the children of `source_dir` into the existing folder `destination_dir`: folders on
/// both sides merge the same way, any other child takes the place of the item with its name (see
/// `replace_child`). A cancel or error stops it; what was copied stays.
pub(super) fn merge_copy(
  source_dir: &Path,
  destination_dir: &Path,
  progress: &mut TransferProgress,
) -> Result<(), String> {
  for entry in read_children(source_dir)? {
    progress.check_cancelled()?;
    let (source_path, destination_path) = (entry.path(), destination_dir.join(entry.file_name()));
    if is_folder_merge(&source_path, &destination_path) {
      merge_copy(&source_path, &destination_path, progress)?;
    } else if fs::symlink_metadata(&destination_path).is_ok() {
      replace_child(&source_path, &destination_path, Transfer::Copy, progress)?;
    } else {
      copy_path_recursive(&source_path, &destination_path, progress)?;
    }
  }
  Ok(())
}

/// Moves the children of `source_dir` into the existing folder `destination_dir` the same way,
/// each child that does not merge moved whole with `move_step`, and removes the source folders it
/// empties. A cancel or error stops it: what moved stays moved and is in `record`, and the source
/// folders still holding something stay. `move_step` is a parameter so tests can run the
/// copy-and-delete path of cross-drive moves on one drive.
pub(super) fn merge_move(
  source_dir: &Path,
  destination_dir: &Path,
  move_step: MoveStep,
  progress: &mut TransferProgress,
  record: &mut MergeRecord,
) -> Result<(), String> {
  for entry in read_children(source_dir)? {
    progress.check_cancelled()?;
    let (source_path, destination_path) = (entry.path(), destination_dir.join(entry.file_name()));
    if is_folder_merge(&source_path, &destination_path) {
      merge_move(&source_path, &destination_path, move_step, progress, record)?;
      continue;
    }
    if fs::symlink_metadata(&destination_path).is_ok() {
      replace_child(&source_path, &destination_path, Transfer::Move(move_step), progress)?;
    } else {
      move_whole(&source_path, &destination_path, move_step, progress)?;
    }
    record.moved_items.push(MovedItem {
      source_path: source_path.to_string_lossy().to_string(),
      destination_path: destination_path.to_string_lossy().to_string(),
    });
  }
  // Fails, and the folder stays, if something was put into it meanwhile.
  if fs::remove_dir(source_dir).is_ok() {
    record.removed_folders.push(source_dir.to_string_lossy().to_string());
  }
  Ok(())
}

/// Puts a child that does not merge in the place of the item with its name (see `replace_item`).
/// The user chose Replace for the top-level item only, so inside a merge a file or link never
/// takes the place of a real folder, which would send everything in it to the Recycle Bin.
fn replace_child(
  source_path: &Path,
  destination_path: &Path,
  transfer: Transfer,
  progress: &mut TransferProgress,
) -> Result<(), String> {
  if is_real_dir(destination_path) {
    return Err(format!("Cannot replace the folder '{}' with a file or link.", destination_path.display()));
  }
  replace_item(source_path, destination_path, transfer, progress)
}

/// Read up front, as a merging move takes the entries out of the folder while it runs.
fn read_children(dir: &Path) -> Result<Vec<fs::DirEntry>, String> {
  fs::read_dir(dir)
    .and_then(|read_dir| read_dir.collect())
    .map_err(|error| path_error(dir, error))
}

#[cfg(test)]
mod tests;
