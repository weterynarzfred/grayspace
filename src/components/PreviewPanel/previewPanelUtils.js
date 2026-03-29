import { getPrimarySelectedPath, getSelectedPathsFromState } from "../../utils/pathSelection";

export const INITIAL_PREVIEW_STATE = {
  status: "idle",
  preview: null,
  error: "",
};

export function getSelectedPreviewPath(selectedFiles = {}) {
  return getPrimarySelectedPath(getSelectedPathsFromState(selectedFiles));
}

export function getPathDisplayName(path) {
  if (typeof path !== "string" || !path) return "";

  const trimmedPath = path.replace(/[\\/]+$/, "");
  if (!trimmedPath) return path;

  const pathSegments = trimmedPath.split(/[\\/]/);
  return pathSegments[pathSegments.length - 1] ?? trimmedPath;
}

export function getErrorMessage(error) {
  if (typeof error === "string" && error) return error;
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && typeof error.message === "string" && error.message) {
    return error.message;
  }

  const fallback = String(error ?? "");
  if (fallback && fallback !== "[object Object]") return fallback;
  return "Failed to load preview.";
}

export function isFolderPreviewErrorMessage(message) {
  return typeof message === "string" && /only available for files/i.test(message);
}

export function getSaveStatusMessage({
  isTextPreviewReady,
  isTextEditable,
  saveStatus,
  saveError,
}) {
  if (!isTextPreviewReady || !isTextEditable) return "";
  if (saveStatus === "saving") return "Saving...";
  if (saveStatus === "saved") return "Saved.";
  if (saveStatus === "dirty") return "Unsaved changes.";
  if (saveStatus === "error") return saveError || "Failed to save file.";
  return "";
}
