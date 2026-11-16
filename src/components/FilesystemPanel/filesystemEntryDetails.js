const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"];
const modifiedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });

// Column order after Name; widths live in `--details-columns` (FilesystemPanel.module.scss).
export const DETAILS_COLUMNS = [
  { key: "modified", label: "Date modified" },
  { key: "type", label: "Type" },
  { key: "size", label: "Size" },
];

export function formatEntrySize(sizeBytes) {
  if (!Number.isFinite(sizeBytes)) return "";
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex > 0 && value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${SIZE_UNITS[unitIndex]}`;
}

export function formatEntryModified(modifiedMs) {
  return Number.isFinite(modifiedMs) ? modifiedFormat.format(modifiedMs) : "";
}

export function describeEntryType(name, isDirectory) {
  if (isDirectory) return "Folder";
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return "File";
  return `${name.slice(dotIndex + 1).toUpperCase()} file`;
}

export function getEntryDetails(entry) {
  return {
    modified: formatEntryModified(entry.modified_ms),
    type: describeEntryType(entry.name, entry.is_dir),
    size: entry.is_dir ? "" : formatEntrySize(entry.size_bytes),
  };
}
