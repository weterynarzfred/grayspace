import { invoke } from "@tauri-apps/api/core";
import { getPathName } from "../hooks/filesystemEntryOperationUtils";

const MAX_LISTED_CONFLICT_NAMES = 3;
const CONFLICT_CHOICES = [
  { id: "replace", label: "Replace" },
  { id: "keep-both", label: "Keep both" },
  { id: "skip", label: "Skip" },
];

function describeConflicts(conflicts, destinationDir) {
  const names = conflicts.slice(0, MAX_LISTED_CONFLICT_NAMES).map((conflict) => getPathName(conflict.path));
  const remainingCount = conflicts.length - names.length;
  const nameList = `${names.join(", ")}${remainingCount > 0 ? ` and ${remainingCount} more` : ""}`;
  const folderName = getPathName(destinationDir) || destinationDir;
  const mergeNote = conflicts.some((conflict) => conflict.mergesFolders)
    ? "Replace merges folders into same-named folders and replaces same-named files inside them. "
    : "";
  return `${nameList} already ${conflicts.length === 1 ? "exists" : "exist"} in "${folderName}". `
    + `${mergeNote}Replaced items go to the Recycle Bin.`;
}

// Asks what to do about names already taken in the destination, when the operation starts, so
// against the folder as it is then. Resolves with the sources to transfer and the backend conflict
// policy, or null when the user cancels the question or the operation (which withdraws the
// question). "Skip" is handled here by leaving the conflicting sources out; Replace with folders
// on both sides merges them in the backend.
// The question of an operation that had to wait comes up while the user does something else. So it
// names the operation and leaves the keyboard alone: a stray Enter can't pick Replace, and an open
// rename box, which commits on blur, keeps its focus. A click elsewhere doesn't cancel it either.
export async function resolveConflicts(sourcePaths, destinationDir, openChoice, operation) {
  const conflicts = await invoke("filesystem_transfer_conflicts", {
    sources: sourcePaths,
    destinationDir,
  });
  // Cancelled while the conflicts were looked up, which no backend job could see.
  if (operation.cancelRequested) return null;
  if (conflicts.length === 0) return { sourcePaths, conflictPolicy: "fail" };

  const { label, startsLater } = operation;
  const title = conflicts.length === 1 ? "Item already exists" : `${conflicts.length} items already exist`;
  const choice = await openChoice?.({
    title: startsLater ? `${label}: ${title}` : title,
    message: describeConflicts(conflicts, destinationDir),
    tone: "warning",
    choices: CONFLICT_CHOICES,
    takeFocus: !startsLater,
    dismissOnOutside: !startsLater,
    signal: operation.abortController.signal,
  });
  if (!choice) return null;
  if (choice !== "skip") return { sourcePaths, conflictPolicy: choice };

  const conflictingPathSet = new Set(conflicts.map((conflict) => conflict.path));
  return {
    sourcePaths: sourcePaths.filter((sourcePath) => !conflictingPathSet.has(sourcePath)),
    conflictPolicy: "fail",
  };
}
