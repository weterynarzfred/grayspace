import { invoke } from "@tauri-apps/api/core";
import { uniqueNonEmptyPaths } from "../../utils/pathSelection";

function normalizeClipboardMode(mode) {
  if (mode === "cut") return "cut";
  if (mode === "copy") return "copy";
  return "";
}

export async function writeFilesystemClipboard(paths = [], mode = "") {
  const normalizedPaths = uniqueNonEmptyPaths(paths);
  const normalizedMode = normalizeClipboardMode(mode);

  try {
    await invoke("filesystem_clipboard_set", {
      paths: normalizedPaths,
      mode: normalizedMode,
    });
  } catch {
    // Best effort.
  }
}

export async function clearFilesystemClipboard() {
  try {
    await invoke("filesystem_clipboard_set", {
      paths: [],
      mode: "",
    });
  } catch {
    // Best effort.
  }
}

export async function readFilesystemClipboard() {
  try {
    const result = await invoke("filesystem_clipboard_get");
    return {
      mode: normalizeClipboardMode(result?.mode),
      paths: uniqueNonEmptyPaths(result?.paths),
    };
  } catch {
    return { mode: "", paths: [] };
  }
}
