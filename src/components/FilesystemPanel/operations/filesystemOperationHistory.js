import { isSamePath } from "../../../utils/pathWatch";
import { normalizeMoveHistoryItems } from "../hooks/filesystemEntryOperationUtils";

const MAX_FILESYSTEM_HISTORY_ITEMS = 100;

// Undo / redo stacks per pane, kept outside the pane so they survive its remounts (tab switch,
// split, closing a sibling pane, panel-type change) and an operation that finishes after one.
const paneHistories = new Map();

export function getPaneHistoryKey(tabId, paneId) {
  return `${tabId}::${paneId}`;
}

// The pane's live { undo, redo } stacks, newest entry last. A change to the undo stack replaces
// it, so a stack read earlier stays as it was then.
export function getPaneHistory(paneKey) {
  if (!paneHistories.has(paneKey)) paneHistories.set(paneKey, { undo: [], redo: [] });
  return paneHistories.get(paneKey);
}

// Puts the entry of an operation where the operation started: on top of `undoAtStart`, the undo
// stack as it was then. Renames run at once, also while an operation runs, so one made meanwhile
// stays above it and Ctrl+Z undoes that first.
export function addUndoEntry(history, entry, undoAtStart = history.undo) {
  // At the bottom when the stack was empty then: indexOf(undefined) is -1.
  const index = history.undo.indexOf(undoAtStart.at(-1)) + 1;
  history.undo = history.undo.toSpliced(index, 0, entry).slice(-MAX_FILESYSTEM_HISTORY_ITEMS);
}

function pushHistoryEntry(paneKey, entry, undoAtStart) {
  const history = getPaneHistory(paneKey);
  addUndoEntry(history, entry, undoAtStart);
  history.redo = [];
}

// `undoAtStart`: the pane's undo stack when the move started (see addUndoEntry).
export function pushMoveHistoryEntry(paneKey, { movedItems, removedFolders }, undoAtStart) {
  const normalizedItems = normalizeMoveHistoryItems(movedItems);
  // A merge of empty folders into existing ones moves no items but removes the source folders.
  if (normalizedItems.length === 0 && removedFolders.length === 0) return;
  pushHistoryEntry(paneKey, {
    kind: "move",
    items: normalizedItems,
    removedFolders,
  }, undoAtStart);
}

export function pushRenameHistoryEntry(paneKey, sourcePath, destinationPath) {
  if (!sourcePath || !destinationPath || isSamePath(sourcePath, destinationPath)) return;
  pushHistoryEntry(paneKey, {
    kind: "rename",
    items: [{ sourcePath, destinationPath }],
  });
}

// Swaps an undo or redo entry for what is left of it. By identity, not pop(): a rename in the pane
// may have landed on top while the entry's items moved.
export function replaceHistoryEntry(entries, entry, remainingEntries) {
  return entries.flatMap((candidate) => (candidate === entry ? remainingEntries : [candidate]));
}

// Keeps the histories of the listed pane keys only, e.g. of the panes still in the window. An
// empty set forgets all of them.
export function forgetPaneHistories(livePaneKeys) {
  for (const paneKey of paneHistories.keys()) {
    if (!livePaneKeys.has(paneKey)) paneHistories.delete(paneKey);
  }
}
