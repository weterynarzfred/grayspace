import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getParentDirectoryPath, normalizePathForComparison } from "../../../utils/pathWatch";

// The Windows menu only takes items of one folder; a search selection can span several, then
// only the right-clicked item is used.
export function resolveShellMenuTarget(context, selectedPaths, currentPath) {
  if (context.targetType === "panel") return { kind: "background", folder: currentPath };
  const folder = normalizePathForComparison(getParentDirectoryPath(context.targetPath));
  const isOneFolder = selectedPaths.every(path => (
    normalizePathForComparison(getParentDirectoryPath(path)) === folder
  ));
  return { kind: "items", paths: isOneFolder ? selectedPaths : [context.targetPath] };
}

// Open and Rename picked in the menu act on the items it was shown for. The panel's own
// selection can't be used: the right-click that opened the menu has changed it since.
export default function useFilesystemShellMenu({
  currentPath,
  resolveSelectedPaths,
  onOpen,
  onRename,
  pushNotification,
}) {
  return useCallback(async (context) => {
    const target = resolveShellMenuTarget(context, resolveSelectedPaths(context), currentPath);
    try {
      const hostVerb = await invoke("filesystem_show_shell_menu", {
        target,
        x: context.pointerX,
        y: context.pointerY,
        extended: context.extendedVerbs === true,
      });
      if (target.kind !== "items") return;
      if (hostVerb === "rename") onRename(context.targetPath);
      if (hostVerb === "open" || hostVerb === "explore") onOpen(target.paths);
    } catch (error) {
      pushNotification?.({
        title: "Windows menu failed",
        message: String(error),
        tone: "error",
      });
    }
  }, [currentPath, onOpen, onRename, pushNotification, resolveSelectedPaths]);
}
