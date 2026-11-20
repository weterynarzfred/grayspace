import { useCallback } from "react";
import { runRedo, runUndo } from "../operations/filesystemHistoryRunners";
import { getPaneHistory } from "../operations/filesystemOperationHistory";
import {
  cancelFilesystemOperation,
  enqueueFilesystemOperation,
  getTabOperations,
  startFilesystemOperationNow,
} from "../operations/filesystemOperationQueue";
import { runCopy, runDelete, runMove } from "../operations/filesystemOperationRunners";
import { getPathName } from "./filesystemEntryOperationUtils";

function describeItems(paths) {
  return paths.length === 1 ? `"${getPathName(paths[0])}"` : `${paths.length} items`;
}

// e.g. 'Moving 3 items to "Archive"'
function describeTransfer(verb, sourcePaths, destinationDir) {
  return `${verb} ${describeItems(sourcePaths)} to "${getPathName(destinationDir)}"`;
}

// The pane's copies, moves, imports, deletes, undos and redos, run one at a time as operations of
// its tab (filesystemOperationQueue). Each resolves with the operation's outcome once it ran, or
// "dropped" when it was taken back before; none rejects, since the runners show their own errors.
// The runners get only paths, the pane's history key and the window's notification functions:
// the pane may have remounted by the time its operation runs or finishes.
export default function useFilesystemQueuedOperations({ tabId, paneKey, openChoice, pushNotification }) {
  const moveEntries = useCallback((sourcePaths, destinationDir) => enqueueFilesystemOperation(tabId, {
    label: describeTransfer("Moving", sourcePaths, destinationDir),
    paneKey,
    run: (operation) => runMove(operation, { sourcePaths, destinationDir, openChoice, pushNotification }),
  }), [openChoice, paneKey, pushNotification, tabId]);

  const copyEntries = useCallback((sourcePaths, destinationDir) => enqueueFilesystemOperation(tabId, {
    label: describeTransfer("Copying", sourcePaths, destinationDir),
    paneKey,
    run: (operation) => runCopy(operation, { sourcePaths, destinationDir, openChoice, pushNotification }),
  }), [openChoice, paneKey, pushNotification, tabId]);

  const importExternalPaths = useCallback((sourcePaths, destinationDir) => enqueueFilesystemOperation(tabId, {
    label: describeTransfer("Importing", sourcePaths, destinationDir),
    paneKey,
    run: (operation) => runCopy(operation, {
      sourcePaths,
      destinationDir,
      openChoice,
      pushNotification,
      errorTitle: "Import failed",
      fallbackMessage: "Failed to import dropped items.",
    }),
  }), [openChoice, paneKey, pushNotification, tabId]);

  const deleteEntries = useCallback((paths) => enqueueFilesystemOperation(tabId, {
    label: `Deleting ${describeItems(paths)}`,
    paneKey,
    run: (operation) => runDelete(operation, { paths, pushNotification }),
  }), [paneKey, pushNotification, tabId]);

  // Ctrl+Z first takes back the pane's newest operation still waiting, which then never runs.
  // Otherwise undo, like redo, starts only while nothing runs in the tab, also ahead of a paused
  // queue. Queued behind a copy, which records no history, it would undo an older move instead.
  const undoEntries = useCallback(() => {
    const { running, queued } = getTabOperations(tabId);
    const newestWaiting = queued.findLast((operation) => operation.paneKey === paneKey);
    if (newestWaiting) {
      cancelFilesystemOperation(tabId, newestWaiting.id);
      return newestWaiting.finished;
    }
    if (running || getPaneHistory(paneKey).undo.length === 0) return undefined;
    return startFilesystemOperationNow(tabId, {
      label: "Undoing",
      paneKey,
      run: (operation) => runUndo(operation, pushNotification),
    });
  }, [paneKey, pushNotification, tabId]);

  const redoEntries = useCallback(() => {
    if (getTabOperations(tabId).running || getPaneHistory(paneKey).redo.length === 0) return undefined;
    return startFilesystemOperationNow(tabId, {
      label: "Redoing",
      paneKey,
      run: (operation) => runRedo(operation, pushNotification),
    });
  }, [paneKey, pushNotification, tabId]);

  return { moveEntries, copyEntries, importExternalPaths, deleteEntries, undoEntries, redoEntries };
}
