import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const FILESYSTEM_TRANSFER_PROGRESS_EVENT = "filesystem-transfer-progress";
const IDLE_TAB_OPERATIONS = Object.freeze({ running: null, queued: Object.freeze([]), paused: false });

// One sequential queue of file operations per tab. Each window is its own JS app, so each has its
// own store, as with filesystemClipboardStore.js. A tab's entry is replaced on every change and
// deleted once nothing runs or waits, so useSyncExternalStore gets a stable snapshot.
const tabOperations = new Map();
const changeListeners = new Set();
const finishListeners = new Set();
let progressUnlistenPromise = null;

export function getTabOperations(tabId) {
  return tabOperations.get(tabId) ?? IDLE_TAB_OPERATIONS;
}

// Without a tab id: whether any tab of the window has operations.
export function hasFilesystemOperations(tabId = undefined) {
  return tabId === undefined ? tabOperations.size > 0 : tabOperations.has(tabId);
}

export function subscribeToFilesystemOperations(listener) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

// Called with the operation record (tabId, removedPaths, changedFolders, ...) of every operation
// that ran, also when it failed or was cancelled; not for one dropped from the queue before it ran.
export function onFilesystemOperationFinished(listener) {
  finishListeners.add(listener);
  return () => finishListeners.delete(listener);
}

function updateProgressFromEvent({ payload }) {
  const operation = [...tabOperations.values()]
    .map(({ running }) => running)
    .find((running) => running?.id === payload.jobId);
  if (!operation) return;
  setOperationProgress(operation, {
    bytesDone: payload.bytesDone,
    bytesTotal: payload.bytesTotal,
    // A move runs one backend call per item, so it counts its items itself.
    itemsDone: operation.progress.kind === "copy" ? payload.itemsDone : operation.progress.itemsDone,
  });
}

// The backend sends the progress of every job to every window, so a window listens only while it
// has operations; events of other windows' jobs match none of them.
function listenToProgressWhileBusy() {
  if (tabOperations.size > 0 && !progressUnlistenPromise) {
    progressUnlistenPromise = listen(FILESYSTEM_TRANSFER_PROGRESS_EVENT, updateProgressFromEvent);
  } else if (tabOperations.size === 0 && progressUnlistenPromise) {
    progressUnlistenPromise.then((unlisten) => unlisten());
    progressUnlistenPromise = null;
  }
}

function setTabOperations(tabId, { running, queued, paused }) {
  if (running || queued.length > 0) {
    // A pause holds back the waiting operations; with none left there is nothing to hold back.
    tabOperations.set(tabId, { running, queued, paused: paused && queued.length > 0 });
  } else {
    tabOperations.delete(tabId);
  }
  listenToProgressWhileBusy();
  changeListeners.forEach((listener) => listener());
}

// Progress and cancelRequested change only here and in cancelFilesystemOperation, which publish a
// new entry for the tab. The record itself keeps its identity: its runner holds it.
export function setOperationProgress(operation, patch) {
  operation.progress = { ...operation.progress, ...patch };
  setTabOperations(operation.tabId, getTabOperations(operation.tabId));
}

function createOperation(tabId, { label, paneKey, run, startsLater }) {
  const { promise, resolve } = Promise.withResolvers();
  return {
    // Also the backend job id, which progress events and Cancel refer to.
    id: `filesystem-transfer-${crypto.randomUUID()}`,
    tabId,
    paneKey,
    label,
    run,
    startsLater,
    progress: null,
    cancelRequested: false,
    // Aborted on Cancel, which withdraws a conflict question the operation still waits on.
    abortController: new AbortController(),
    removedPaths: [],
    // The folders whose listing it changed; only panes showing one of them list it again.
    changedFolders: [],
    finished: promise,
    settle: resolve,
  };
}

async function runOperation(operation) {
  let outcome;
  try {
    outcome = await operation.run(operation);
  } catch (error) {
    // Runners show their own errors; one that throws anyway must not hold up the tab.
    console.error(error);
    outcome = "failed";
  }
  const { queued, paused } = getTabOperations(operation.tabId);
  // What waits behind a failed or cancelled operation may depend on it (a delete of the originals
  // after a copy to a backup), so it waits for Resume.
  setTabOperations(operation.tabId, { running: null, queued, paused: paused || outcome !== "done" });
  finishListeners.forEach((listener) => listener(operation));
  operation.settle(outcome);
  runNextOperation(operation.tabId);
}

function runNextOperation(tabId) {
  const { running, queued: [next, ...queued], paused } = getTabOperations(tabId);
  if (running || paused || !next) return;
  setTabOperations(tabId, { running: next, queued, paused });
  runOperation(next);
}

// `run(operation)` resolves with "done", "failed" or "cancelled" and shows its own errors. The
// returned promise resolves with that outcome, or with "dropped" when the operation is taken off
// the queue before it runs. It never rejects.
export function enqueueFilesystemOperation(tabId, { label, paneKey, run }) {
  const { running, queued, paused } = getTabOperations(tabId);
  // Its conflict question may then come up while the user is doing something else.
  const startsLater = Boolean(running) || queued.length > 0;
  const operation = createOperation(tabId, { label, paneKey, run, startsLater });
  setTabOperations(tabId, { running, queued: [...queued, operation], paused });
  runNextOperation(tabId);
  return operation.finished;
}

// For undo and redo, which start only while nothing runs in the tab: they go ahead of a paused
// queue and leave it paused.
export function startFilesystemOperationNow(tabId, { label, paneKey, run }) {
  const operation = createOperation(tabId, { label, paneKey, run, startsLater: false });
  setTabOperations(tabId, { ...getTabOperations(tabId), running: operation });
  runOperation(operation);
  return operation.finished;
}

// The running operation stops at its next check: a move between items, a copy or a cross-drive
// move inside the backend. Its conflict question, if still open, is withdrawn: no backend job runs
// yet that could stop it. A waiting one is taken off the queue without pausing it.
export function cancelFilesystemOperation(tabId, operationId) {
  const { running, queued, paused } = getTabOperations(tabId);
  if (running?.id === operationId) {
    running.cancelRequested = true;
    running.abortController.abort();
    setTabOperations(tabId, { running, queued, paused });
    invoke("filesystem_transfer_cancel", { jobId: operationId }).catch(() => {});
    return;
  }

  const operation = queued.find(({ id }) => id === operationId);
  // A Cancel clicked as the operation ended finds it neither running nor waiting.
  if (!operation) return;
  setTabOperations(tabId, { running, queued: queued.filter((candidate) => candidate !== operation), paused });
  operation.settle("dropped");
}

// Also ends a pause, since nothing is left to hold back.
export function cancelQueuedFilesystemOperations(tabId) {
  const { running, queued } = getTabOperations(tabId);
  setTabOperations(tabId, { running, queued: [], paused: false });
  queued.forEach((operation) => operation.settle("dropped"));
}

export function resumeFilesystemOperations(tabId) {
  setTabOperations(tabId, { ...getTabOperations(tabId), paused: false });
  runNextOperation(tabId);
}

// For closing the tab: resolves once nothing of it runs or waits, so the running operation's
// cleanup is done (partial copies removed, Replace staging undone). The tab stays usable while
// that operation stops, so what is started meanwhile is cancelled too.
export async function cancelTabFilesystemOperations(tabId) {
  while (hasFilesystemOperations(tabId)) {
    const { running } = getTabOperations(tabId);
    cancelQueuedFilesystemOperations(tabId);
    if (running) {
      cancelFilesystemOperation(tabId, running.id);
      await running.finished;
    }
  }
}

// For closing the window. Again until none are left: a tab that had none may start one meanwhile.
export async function cancelAllFilesystemOperations() {
  while (tabOperations.size > 0) {
    await Promise.all([...tabOperations.keys()].map(cancelTabFilesystemOperations));
  }
}

// For tests, which share this module within a file: forgets every operation and listener.
export function resetFilesystemOperationQueue() {
  tabOperations.clear();
  listenToProgressWhileBusy();
  changeListeners.clear();
  finishListeners.clear();
}
