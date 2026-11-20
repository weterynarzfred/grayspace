import { invoke } from "@tauri-apps/api/core";
import { getParentDirectoryPath } from "../../../utils/pathWatch";
import { resolveDestinationPath } from "../hooks/filesystemEntryOperationUtils";
import { getNavigationErrorMessage } from "../hooks/filesystemNavigationUtils";
import { getPaneHistory, pushMoveHistoryEntry } from "./filesystemOperationHistory";
import { setOperationProgress } from "./filesystemOperationQueue";
import { resolveConflicts } from "./transferConflicts";

// Runners of queued operations, called as `run(operation)` by the queue. They hold no pane
// callbacks, since the pane may have remounted by the time they finish: on the queue's finish
// event, panes drop operation.removedPaths from their selection, and those showing one of
// operation.changedFolders list it again.

// Without focus: a toast that arrives while the user types a rename would blur the rename box,
// which commits on blur.
export function notifyOperationFailure(pushNotification, title, error, fallbackMessage) {
  pushNotification?.({
    title,
    message: getNavigationErrorMessage(error, fallbackMessage),
    tone: "error",
    takeFocus: false,
  });
}

export function getOperationOutcome(operation, error) {
  if (error) return "failed";
  return operation.cancelRequested ? "cancelled" : "done";
}

// Resolves with what moved, for the history, the folders whose listing changed, and the error
// that stopped it part way, if any: a merge into an existing folder lists the items it moved
// inside it (also when it stopped part way) and the source folders it removed. Undo recreates
// such folders before moving the items back and redo removes them again after, both within the
// same operation.
export async function runMovePairs(
  operation,
  movePairs,
  { conflictPolicy = "fail", recreateFolders = [], removeEmptyFolders = [] } = {},
) {
  // Dropping a selection onto one of its own folders moves the rest into it.
  const actionablePairs = movePairs.filter((pair) => pair.sourcePath !== pair.destinationDir);
  const movedSourcePaths = [];
  const movedItems = [];
  const removedFolders = [];
  const changedFolders = new Set();
  let error = null;

  setOperationProgress(operation, {
    kind: "move",
    itemsDone: 0,
    itemsTotal: actionablePairs.length,
    bytesDone: 0,
    bytesTotal: 0,
  });
  try {
    if (recreateFolders.length > 0) {
      await invoke("recreate_folders", { paths: recreateFolders });
      for (const folder of recreateFolders) changedFolders.add(getParentDirectoryPath(folder));
    }
    for (const pair of actionablePairs) {
      if (operation.cancelRequested) break;
      const moveResult = await invoke("move_path", {
        source: pair.sourcePath,
        destinationDir: pair.destinationDir,
        targetName: pair.targetName,
        jobId: operation.id,
        conflictPolicy,
      });
      if (moveResult.merge) {
        // One by one: spreading a record of 100k+ items into push() overflows the call stack.
        for (const item of moveResult.merge.movedItems) movedItems.push(item);
        for (const folder of moveResult.merge.removedFolders) removedFolders.push(folder);
      } else {
        movedItems.push({
          sourcePath: pair.sourcePath,
          destinationPath: resolveDestinationPath(pair.sourcePath, pair.destinationDir, moveResult.destination),
        });
      }
      movedSourcePaths.push(pair.sourcePath);
      changedFolders.add(getParentDirectoryPath(pair.sourcePath)).add(pair.destinationDir);
      // Each move call reports the bytes of its own item, so they start over.
      setOperationProgress(operation, { itemsDone: movedSourcePaths.length, bytesDone: 0, bytesTotal: 0 });
      // A merge that failed part way reports what it moved until then, recorded above.
      if (moveResult.error) throw moveResult.error;
    }
    if (removeEmptyFolders.length > 0) {
      await invoke("remove_empty_folders", { paths: removeEmptyFolders });
      for (const folder of removeEmptyFolders) changedFolders.add(getParentDirectoryPath(folder));
    }
  } catch (moveError) {
    if (!operation.cancelRequested) error = moveError;
  }

  return { movedSourcePaths, movedItems, removedFolders, changedFolders: [...changedFolders], error };
}

export async function runMove(operation, { sourcePaths, destinationDir, openChoice, pushNotification }) {
  const resolved = await resolveConflicts(sourcePaths, destinationDir, openChoice, operation);
  if (!resolved) return "cancelled";

  // The move starts now: a rename made while its question was open came before it, one made while
  // it moves comes after it.
  const undoAtStart = getPaneHistory(operation.paneKey).undo;
  const moved = await runMovePairs(
    operation,
    resolved.sourcePaths.map((sourcePath) => ({ sourcePath, destinationDir })),
    { conflictPolicy: resolved.conflictPolicy },
  );
  operation.removedPaths = moved.movedSourcePaths;
  operation.changedFolders = moved.changedFolders;
  // What moved before an error or a cancel can be undone too.
  pushMoveHistoryEntry(operation.paneKey, moved, undoAtStart);
  if (moved.error) notifyOperationFailure(pushNotification, "Move failed", moved.error, "Failed to move item.");
  return getOperationOutcome(operation, moved.error);
}

// A copy, or an import of items dropped from Explorer, in one backend call. Copies record no
// history.
export async function runCopy(operation, {
  sourcePaths,
  destinationDir,
  openChoice,
  pushNotification,
  errorTitle = "Copy failed",
  fallbackMessage = "Failed to copy item.",
}) {
  const resolved = await resolveConflicts(sourcePaths, destinationDir, openChoice, operation);
  if (!resolved) return "cancelled";
  if (resolved.sourcePaths.length === 0) return "done";

  setOperationProgress(operation, {
    kind: "copy",
    itemsDone: 0,
    itemsTotal: resolved.sourcePaths.length,
    bytesDone: 0,
    bytesTotal: 0,
  });
  // Also when it fails or is cancelled part way: what was copied by then stays.
  operation.changedFolders = [destinationDir];
  try {
    await invoke("import_paths", {
      paths: resolved.sourcePaths,
      destinationDir,
      jobId: operation.id,
      conflictPolicy: resolved.conflictPolicy,
    });
  } catch (copyError) {
    // A cancelled copy fails with the backend's cancel error, which is no failure to show.
    if (operation.cancelRequested) return "cancelled";
    notifyOperationFailure(pushNotification, errorTitle, copyError, fallbackMessage);
    return "failed";
  }
  // A Cancel that came too late to stop the backend still holds back what waits behind the copy.
  return operation.cancelRequested ? "cancelled" : "done";
}

// To the Recycle Bin. The backend skips paths that are already gone. No progress or Cancel yet.
export async function runDelete(operation, { paths, pushNotification }) {
  // Also when it fails: some may have gone by then.
  operation.changedFolders = [...new Set(paths.map(getParentDirectoryPath))];
  try {
    await invoke("delete_paths", { paths });
  } catch (deleteError) {
    notifyOperationFailure(pushNotification, "Delete failed", deleteError, "Failed to delete item.");
    return "failed";
  }
  operation.removedPaths = paths;
  return "done";
}
