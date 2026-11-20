import { useCallback } from "react";
import {
  clearFilesystemClipboard,
  readFilesystemClipboard,
  writeFilesystemClipboard,
} from "../filesystemClipboardApi";
import {
  clearFilesystemClipboardState,
  getFilesystemClipboardState,
  setFilesystemClipboardState,
} from "../filesystemClipboardStore";
import { uniqueNonEmptyPaths } from "../../../utils/pathSelection";
import { getParentDirectoryPath, isSamePath } from "../../../utils/pathWatch";

// Right-clicked folder, else the first selected folder, else the selected file's folder.
export function resolvePasteDestination(commandContext, selectedPaths, entryByPath, currentPath) {
  if (
    commandContext?.source === "context-menu"
    && commandContext?.targetType === "folder"
    && commandContext?.targetScope === "tree-entry"
    && commandContext?.targetPath
  ) {
    return commandContext.targetPath;
  }

  const selectedFolderPath = selectedPaths.find((path) => entryByPath[path]?.is_dir === true);
  if (selectedFolderPath) return selectedFolderPath;

  const selectedFilePath = selectedPaths.find((path) => entryByPath[path]?.is_dir === false);
  if (selectedFilePath) return getParentDirectoryPath(selectedFilePath) || currentPath;

  return currentPath;
}

// Copy and cut go to the Windows clipboard and to grayspace's own copy of it; paste reads
// the Windows clipboard first, so files copied in Explorer paste here too.
export default function useFilesystemClipboardCommands({
  isEnabled,
  currentPath,
  entryByPath,
  resolveSelectedPaths,
  copyEntries,
  moveEntries,
}) {
  const copySelection = useCallback((mode, commandContext = {}) => {
    if (!isEnabled) return false;
    const selectedPaths = resolveSelectedPaths(commandContext);
    if (selectedPaths.length === 0) return false;

    setFilesystemClipboardState(mode, selectedPaths);
    writeFilesystemClipboard(selectedPaths, mode);
    return true;
  }, [isEnabled, resolveSelectedPaths]);

  const pasteEntries = useCallback(async (commandContext = {}) => {
    if (!isEnabled) return false;

    const systemClipboardState = await readFilesystemClipboard();
    const localClipboardState = getFilesystemClipboardState();
    const clipboardMode = systemClipboardState.mode || localClipboardState.mode;
    const clipboardPaths = uniqueNonEmptyPaths(
      systemClipboardState.paths.length > 0 ? systemClipboardState.paths : localClipboardState.paths,
    );
    if (!clipboardMode || clipboardPaths.length === 0) return false;

    const destinationDir = resolvePasteDestination(
      commandContext,
      resolveSelectedPaths(commandContext),
      entryByPath,
      currentPath,
    );

    // Both may wait their turn in the tab's queue; paste doesn't wait for them.
    if (clipboardMode === "copy") {
      copyEntries(clipboardPaths, destinationDir);
      return true;
    }

    const actionableMovePaths = clipboardPaths.filter((sourcePath) => {
      if (isSamePath(sourcePath, destinationDir)) return false;
      const sourceParentPath = getParentDirectoryPath(sourcePath);
      return !(sourceParentPath && isSamePath(sourceParentPath, destinationDir));
    });
    if (actionableMovePaths.length === 0) return false;

    // Cleared once the move is queued, so a second paste can't queue the same move again.
    moveEntries(actionableMovePaths, destinationDir);
    clearFilesystemClipboardState();
    await clearFilesystemClipboard();
    return true;
  }, [copyEntries, currentPath, entryByPath, isEnabled, moveEntries, resolveSelectedPaths]);

  return { copySelection, pasteEntries };
}
