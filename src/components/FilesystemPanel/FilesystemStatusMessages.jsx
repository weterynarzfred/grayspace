import styles from "./FilesystemPanel.module.scss";

function buildStatusMessages({
  isBrowsing,
  isLoadingDrives,
  isLoadingEntries,
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
  if (error) messages.push({ id: "error", text: error, tone: "error" });

  return messages;
}

// The tab's file operations have their own line (FilesystemOperationStatus).
function FilesystemStatusMessages({
  isBrowsing,
  isLoadingDrives,
  isLoadingEntries,
  error,
}) {
  const messages = buildStatusMessages({
    isBrowsing,
    isLoadingDrives,
    isLoadingEntries,
    error,
  });

  return <>
    {messages.map(message => <p
      key={message.id}
      className={message.tone === "error" ? styles.error : styles.muted}
    >{message.text}</p>)}
  </>;
}

export default FilesystemStatusMessages;
