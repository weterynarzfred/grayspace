import styles from "./FilesystemPanel.module.scss";

function buildStatusMessages({
  isBrowsing,
  isLoadingDrives,
  isLoadingEntries,
  isMovingEntry,
  isDeletingEntries,
  isImportingExternal,
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
  if (isBrowsing && isMovingEntry) {
    messages.push({ id: "moving-entry", text: "Moving item...", tone: "muted" });
  }
  if (isBrowsing && isDeletingEntries) {
    messages.push({ id: "deleting-entries", text: "Deleting selected items...", tone: "muted" });
  }
  if (isBrowsing && isImportingExternal) {
    messages.push({
      id: "importing-external",
      text: "Importing dropped items...",
      tone: "muted",
    });
  }
  if (error) {
    messages.push({ id: "error", text: error, tone: "error" });
  }

  return messages;
}

function FilesystemStatusMessages({
  isBrowsing,
  isLoadingDrives,
  isLoadingEntries,
  isMovingEntry,
  isDeletingEntries,
  isImportingExternal,
  error,
}) {
  const messages = buildStatusMessages({
    isBrowsing,
    isLoadingDrives,
    isLoadingEntries,
    isMovingEntry,
    isDeletingEntries,
    isImportingExternal,
    error,
  });

  return messages.map((message) => (
    <p key={message.id} className={message.tone === "error" ? styles.error : styles.muted}>
      {message.text}
    </p>
  ));
}

export default FilesystemStatusMessages;
