import { formatEntrySize } from "./filesystemEntryDetails";
import styles from "./FilesystemPanel.module.scss";

// e.g. "Copying 2 of 5 items, 34% (1.2 GB of 3.4 GB)"
export function describeTransferProgress({ kind, itemsDone, itemsTotal, bytesDone, bytesTotal }) {
  const verb = kind === "copy" ? "Copying" : "Moving";
  const items = itemsTotal > 1 ? ` ${Math.min(itemsDone + 1, itemsTotal)} of ${itemsTotal} items` : "";
  const bytes = bytesTotal > 0
    ? `, ${Math.floor((bytesDone / bytesTotal) * 100)}% (${formatEntrySize(bytesDone)} of ${formatEntrySize(bytesTotal)})`
    : "";
  return `${verb}${items}${bytes}...`;
}

function buildStatusMessages({
  isBrowsing,
  isLoadingDrives,
  isLoadingEntries,
  isMovingEntry,
  isDeletingEntries,
  isImportingExternal,
  hasTransferProgress,
  error,
}) {
  const messages = [];

  if (!isBrowsing) {
    messages.push({ id: "select-drive", text: "Select a drive", tone: "muted" });
  }
  if (!isBrowsing && isLoadingDrives) {
    messages.push({ id: "loading-drives", text: "Loading drives...", tone: "muted" });
  }
  if (isBrowsing && isLoadingEntries) {
    messages.push({
      id: "loading-entries",
      text: "Loading folder contents...",
      tone: "muted",
    });
  }
  if (isBrowsing && isMovingEntry && !hasTransferProgress) {
    messages.push({ id: "moving-entry", text: "Moving item...", tone: "muted" });
  }
  if (isBrowsing && isDeletingEntries) {
    messages.push({ id: "deleting-entries", text: "Deleting selected items...", tone: "muted" });
  }
  if (isBrowsing && isImportingExternal && !hasTransferProgress) {
    messages.push({
      id: "importing-external",
      text: "Importing dropped items...",
      tone: "muted",
    });
  }
  if (error) messages.push({ id: "error", text: error, tone: "error" });

  return messages;
}

function FilesystemStatusMessages({
  isBrowsing,
  isLoadingDrives,
  isLoadingEntries,
  isMovingEntry,
  isDeletingEntries,
  isImportingExternal,
  transferProgress = null,
  onCancelTransfer = undefined,
  error,
}) {
  const messages = buildStatusMessages({
    isBrowsing,
    isLoadingDrives,
    isLoadingEntries,
    isMovingEntry,
    isDeletingEntries,
    isImportingExternal,
    hasTransferProgress: Boolean(transferProgress),
    error,
  });

  return <>
    {transferProgress && <p className={styles.muted} role="status">
      {describeTransferProgress(transferProgress)}
      <button type="button" className={styles.cancelTransferButton} onClick={onCancelTransfer}>Cancel</button>
    </p>}
    {messages.map(message => <p
      key={message.id}
      className={message.tone === "error" ? styles.error : styles.muted}
    >{message.text}</p>)}
  </>;
}

export default FilesystemStatusMessages;
