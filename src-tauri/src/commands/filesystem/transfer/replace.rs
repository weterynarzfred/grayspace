use super::{copy_to_free_path, path_error, remove_path, MoveStep, TransferProgress};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

/// Copies, or moves with a `MoveStep` (`rename_or_copy` outside tests).
#[derive(Clone, Copy)]
pub(super) enum Transfer {
  Copy,
  Move(MoveStep),
}

/// Puts the item in place of the existing one at `destination_path`, which goes to the Recycle
/// Bin, so that a cancel or error keeps the old item where it is. The new item is first staged
/// under a free name next to it (renamed there, or copied without touching the source), then the
/// old item goes to the Recycle Bin and the staged one is renamed into its place; only after that
/// is the source of a move across drives removed. A failure before that last rename undoes the
/// staging: a renamed item goes back to the source, a copy is removed. If the last rename fails,
/// the old item is already in the Recycle Bin and the new one stays under the staging name; the
/// source of a move across drives stays as well. When the staged item stays after the Recycle Bin
/// step or the last rename fails, also when undoing the staging fails, the error names it.
pub(super) fn replace_item(
  source_path: &Path,
  destination_path: &Path,
  transfer: Transfer,
  progress: &mut TransferProgress,
) -> Result<(), String> {
  let staged_path = free_staging_path(destination_path);
  let staged_is_copy = match transfer {
    Transfer::Copy => {
      copy_to_free_path(source_path, &staged_path, progress)?;
      true
    }
    Transfer::Move(move_step) => move_step(source_path, &staged_path, progress)?,
  };
  if let Err(error) = trash::delete(destination_path) {
    // A copy holds only what this call made; a renamed item is the user's own and goes back.
    let undone = if staged_is_copy {
      remove_path(&staged_path)
    } else {
      fs::rename(&staged_path, source_path).map_err(|error| path_error(&staged_path, error))
    };
    let trash_error = path_error(destination_path, error);
    return Err(match undone {
      Ok(()) => trash_error,
      Err(undo_error) => format!("{trash_error}. Its replacement could not be taken back and stays at {undo_error}"),
    });
  }
  fs::rename(&staged_path, destination_path).map_err(|error| {
    format!(
      "'{}' went to the Recycle Bin, but '{}' could not be renamed to take its place: {error}",
      destination_path.display(),
      staged_path.display()
    )
  })?;
  if staged_is_copy && matches!(transfer, Transfer::Move(_)) {
    remove_path(source_path)?;
  }
  Ok(())
}

// Shared by every transfer in the app (it runs as a single instance), so two replaces staging in
// the same folder at the same moment never pick the same name: fs::rename would overwrite the
// other one's staged item, for a move the user's only copy.
static NEXT_STAGING_NUMBER: AtomicUsize = AtomicUsize::new(1);

/// A free path next to `path`, to stage its replacement at. The name is short and not built from
/// the item's own name, which can be as long as a name can be.
pub(super) fn free_staging_path(path: &Path) -> PathBuf {
  loop {
    let number = NEXT_STAGING_NUMBER.fetch_add(1, Ordering::Relaxed);
    let candidate = path.with_file_name(format!(".grayspace-{number}"));
    if fs::symlink_metadata(&candidate).is_err() {
      return candidate;
    }
  }
}
