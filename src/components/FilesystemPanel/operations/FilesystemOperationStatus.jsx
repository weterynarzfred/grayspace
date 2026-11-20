import { useSyncExternalStore } from "react";
import { formatEntrySize } from "../filesystemEntryDetails";
import {
  cancelFilesystemOperation,
  cancelQueuedFilesystemOperations,
  getTabOperations,
  resumeFilesystemOperations,
  subscribeToFilesystemOperations,
} from "./filesystemOperationQueue";
import styles from "../FilesystemPanel.module.scss";

// e.g. "Copying 2 of 5 items, 34% (1.2 GB of 3.4 GB)..."
export function describeTransferProgress({ kind, itemsDone, itemsTotal, bytesDone, bytesTotal }) {
  const verb = kind === "copy" ? "Copying" : "Moving";
  const items = itemsTotal > 1 ? ` ${Math.min(itemsDone + 1, itemsTotal)} of ${itemsTotal} items` : "";
  const bytes = bytesTotal > 0
    ? `, ${Math.floor((bytesDone / bytesTotal) * 100)}% (${formatEntrySize(bytesDone)} of ${formatEntrySize(bytesTotal)})`
    : "";
  return `${verb}${items}${bytes}...`;
}

// Without progress, the operation waits for its conflict answer, or has none to report (a delete,
// the undo of a rename).
function describeRunningOperation({ label, progress, cancelRequested }) {
  if (cancelRequested) return "Cancelling...";
  if (progress) return describeTransferProgress(progress);
  return `${label}...`;
}

// The tab's file operations, in the header of each of its Filesystem panes, also of one mounted
// while they run: the running one with Cancel, then what waits behind it, with Resume once a
// failed or cancelled operation paused the queue.
export default function FilesystemOperationStatus({ tabId }) {
  const { running, queued, paused } = useSyncExternalStore(
    subscribeToFilesystemOperations,
    () => getTabOperations(tabId),
  );
  if (!running && queued.length === 0) return null;

  return <p className={styles.muted} role="status" aria-label="File operations">
    {running && <>
      {describeRunningOperation(running)}
      {running.progress && !running.cancelRequested && <button
        type="button"
        className={styles.operationButton}
        onClick={() => cancelFilesystemOperation(tabId, running.id)}
      >Cancel</button>}
    </>}
    {queued.length > 0 && <>
      <span title={queued.map((operation) => operation.label).join("\n")}>
        {running ? " · " : ""}{paused ? "Paused · " : ""}{queued.length} queued
      </span>
      {paused && <button
        type="button"
        className={styles.operationButton}
        onClick={() => resumeFilesystemOperations(tabId)}
      >Resume</button>}
      <button
        type="button"
        className={styles.operationButton}
        onClick={() => cancelQueuedFilesystemOperations(tabId)}
      >Cancel queued</button>
    </>}
  </p>;
}
