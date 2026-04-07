import { uniqueNonEmptyPaths } from "../../utils/pathSelection";

const DEFAULT_STATE = Object.freeze({
  mode: "",
  paths: [],
});

let clipboardState = DEFAULT_STATE;

export function getFilesystemClipboardState() {
  return clipboardState;
}

export function setFilesystemClipboardState(mode, paths = []) {
  const normalizedMode = mode === "cut" ? "cut" : (mode === "copy" ? "copy" : "");
  const normalizedPaths = uniqueNonEmptyPaths(paths);

  if (!normalizedMode || normalizedPaths.length === 0) {
    clipboardState = DEFAULT_STATE;
    return clipboardState;
  }

  clipboardState = {
    mode: normalizedMode,
    paths: normalizedPaths,
  };
  return clipboardState;
}

export function clearFilesystemClipboardState() {
  clipboardState = DEFAULT_STATE;
  return clipboardState;
}
