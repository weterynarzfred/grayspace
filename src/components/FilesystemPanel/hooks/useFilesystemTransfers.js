import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPathName } from "./filesystemEntryOperationUtils";

const FILESYSTEM_TRANSFER_PROGRESS_EVENT = "filesystem-transfer-progress";
const MAX_LISTED_CONFLICT_NAMES = 3;
const CONFLICT_CHOICES = [
  { id: "replace", label: "Replace" },
  { id: "keep-both", label: "Keep both" },
  { id: "skip", label: "Skip" },
];

function createTransferJobId() {
  return `filesystem-transfer-${crypto.randomUUID()}`;
}

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

// Progress, cancel and name-conflict handling for copy / move operations that run in the
// backend. Copies report items and bytes from the backend; moves run one backend call per item,
// so their item count is advanced here and the events only carry bytes of cross-drive moves.
export default function useFilesystemTransfers({ openChoice = undefined }) {
  const [transferProgress, setTransferProgress] = useState(null);
  const activeTransferRef = useRef(null);

  useEffect(() => {
    const unlistenPromise = listen(FILESYSTEM_TRANSFER_PROGRESS_EVENT, ({ payload }) => {
      const transfer = activeTransferRef.current;
      if (!transfer || payload.jobId !== transfer.jobId) return;
      setTransferProgress((previous) => previous && {
        ...previous,
        bytesDone: payload.bytesDone,
        bytesTotal: payload.bytesTotal,
        itemsDone: transfer.kind === "copy" ? payload.itemsDone : previous.itemsDone,
      });
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const beginTransfer = useCallback((kind, itemsTotal) => {
    const transfer = { jobId: createTransferJobId(), kind, cancelRequested: false };
    activeTransferRef.current = transfer;
    setTransferProgress({ kind, itemsDone: 0, itemsTotal, bytesDone: 0, bytesTotal: 0 });
    return transfer;
  }, []);

  const advanceTransfer = useCallback((itemsDone) => {
    setTransferProgress((previous) => previous && { ...previous, itemsDone, bytesDone: 0, bytesTotal: 0 });
  }, []);

  const endTransfer = useCallback(() => {
    activeTransferRef.current = null;
    setTransferProgress(null);
  }, []);

  const cancelTransfer = useCallback(() => {
    const transfer = activeTransferRef.current;
    if (!transfer) return;
    transfer.cancelRequested = true;
    invoke("filesystem_transfer_cancel", { jobId: transfer.jobId }).catch(() => {});
  }, []);

  // Asks what to do about names already taken in the destination. Resolves with the sources to
  // transfer and the backend conflict policy, or null when the user cancels. "Skip" is handled
  // here by leaving the conflicting sources out; Replace with folders on both sides merges them
  // in the backend.
  const resolveConflicts = useCallback(async (sourcePaths, destinationDir) => {
    const conflicts = await invoke("filesystem_transfer_conflicts", {
      sources: sourcePaths,
      destinationDir,
    });
    if (conflicts.length === 0) return { sourcePaths, conflictPolicy: "fail" };

    const choice = await openChoice?.({
      title: conflicts.length === 1 ? "Item already exists" : `${conflicts.length} items already exist`,
      message: describeConflicts(conflicts, destinationDir),
      tone: "warning",
      choices: CONFLICT_CHOICES,
    });
    if (!choice) return null;
    if (choice !== "skip") return { sourcePaths, conflictPolicy: choice };

    const conflictingPathSet = new Set(conflicts.map((conflict) => conflict.path));
    return {
      sourcePaths: sourcePaths.filter((sourcePath) => !conflictingPathSet.has(sourcePath)),
      conflictPolicy: "fail",
    };
  }, [openChoice]);

  return {
    transferProgress,
    beginTransfer,
    advanceTransfer,
    endTransfer,
    cancelTransfer,
    resolveConflicts,
  };
}
