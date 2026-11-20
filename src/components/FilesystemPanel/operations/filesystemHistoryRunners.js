import { invoke } from "@tauri-apps/api/core";
import { getParentDirectoryPath } from "../../../utils/pathWatch";
import { getPathName } from "../hooks/filesystemEntryOperationUtils";
import { addUndoEntry, getPaneHistory, replaceHistoryEntry } from "./filesystemOperationHistory";
import { getOperationOutcome, notifyOperationFailure, runMovePairs } from "./filesystemOperationRunners";

// Undo and redo of the pane's newest entry, run as operations of its tab. They start only while
// nothing else runs in the tab, so the only other change to the pane's history meanwhile is an
// immediate rename, which stays on top: undo replaces its own entry by identity, and redo puts
// the redone entry below such renames.

async function renameHistoryItems(items, reverse) {
  for (const item of reverse ? items.toReversed() : items) {
    const sourcePath = reverse ? item.destinationPath : item.sourcePath;
    const destinationPath = reverse ? item.sourcePath : item.destinationPath;
    await invoke("rename_path", {
      path: sourcePath,
      newName: getPathName(destinationPath),
      allowAdjustment: false,
    });
  }
}

export async function runUndo(operation, pushNotification) {
  const history = getPaneHistory(operation.paneKey);
  const entry = history.undo.at(-1);

  if (entry.kind === "rename") {
    try {
      await renameHistoryItems(entry.items, true);
    } catch (undoError) {
      notifyOperationFailure(pushNotification, "Undo failed", undoError, "Failed to undo rename.");
      return "failed";
    }
    // A rename stays in its folder.
    operation.changedFolders = entry.items.map((item) => getParentDirectoryPath(item.sourcePath));
    history.undo = replaceHistoryEntry(history.undo, entry, []);
    history.redo.push(entry);
    return "done";
  }

  const { items } = entry;
  const undoPairs = items.toReversed().map((item) => ({
    sourcePath: item.destinationPath,
    destinationDir: getParentDirectoryPath(item.sourcePath),
    // Back under its own name, which Keep both may have changed.
    targetName: getPathName(item.sourcePath),
  }));
  const { movedItems, changedFolders, error } = await runMovePairs(operation, undoPairs, {
    // A merge removed the source folders it emptied; the items go back into them.
    recreateFolders: entry.removedFolders,
  });
  operation.changedFolders = changedFolders;
  // A cancel or error part way leaves the items it did not move back on the undo stack. Both
  // parts keep the removed folders: recreating one that is there does nothing, and redo
  // removes only empty ones.
  const notUndone = items.slice(0, items.length - movedItems.length);
  const undone = items.slice(items.length - movedItems.length);
  const stillToUndo = [];
  if (notUndone.length > 0) stillToUndo.push({ ...entry, items: notUndone });
  if (undone.length > 0) history.redo.push({ ...entry, items: undone });
  // A merge that only removed folders has no items: it is undone once they are back.
  if (items.length === 0 && error) stillToUndo.push(entry);
  if (items.length === 0 && !error) history.redo.push(entry);
  history.undo = replaceHistoryEntry(history.undo, entry, stillToUndo);

  if (error) notifyOperationFailure(pushNotification, "Undo failed", error, "Failed to undo move.");
  return getOperationOutcome(operation, error);
}

export async function runRedo(operation, pushNotification) {
  const history = getPaneHistory(operation.paneKey);
  const entry = history.redo.at(-1);
  const undoAtStart = history.undo;

  if (entry.kind === "rename") {
    try {
      await renameHistoryItems(entry.items, false);
    } catch (redoError) {
      notifyOperationFailure(pushNotification, "Redo failed", redoError, "Failed to redo rename.");
      return "failed";
    }
    operation.changedFolders = entry.items.map((item) => getParentDirectoryPath(item.sourcePath));
    history.redo = replaceHistoryEntry(history.redo, entry, []);
    addUndoEntry(history, entry, undoAtStart);
    return "done";
  }

  const { items } = entry;
  const redoPairs = items.map((item) => ({
    sourcePath: item.sourcePath,
    destinationDir: getParentDirectoryPath(item.destinationPath),
    targetName: getPathName(item.destinationPath),
  }));
  const { movedItems, changedFolders, error } = await runMovePairs(operation, redoPairs, {
    // As the merge did, leaves no emptied source folders behind.
    removeEmptyFolders: entry.removedFolders,
  });
  operation.changedFolders = changedFolders;
  // Split as in undo: the items a cancel or error left stay on the redo stack.
  const redone = items.slice(0, movedItems.length);
  const notRedone = items.slice(movedItems.length);
  const stillToRedo = [];
  if (notRedone.length > 0) stillToRedo.push({ ...entry, items: notRedone });
  if (redone.length > 0) addUndoEntry(history, { ...entry, items: redone }, undoAtStart);
  if (items.length === 0 && error) stillToRedo.push(entry);
  if (items.length === 0 && !error) addUndoEntry(history, entry, undoAtStart);
  history.redo = replaceHistoryEntry(history.redo, entry, stillToRedo);

  if (error) notifyOperationFailure(pushNotification, "Redo failed", error, "Failed to redo move.");
  return getOperationOutcome(operation, error);
}
