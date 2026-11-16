import { useCallback } from "react";
import { isPathInsideRoot } from "../filesystemPanelUtils";
import { isSamePath } from "../../../utils/pathWatch";

function normalizeDriveLetterPath(path) {
  if (typeof path !== "string") return "";
  const trimmedPath = path.trim();
  if (!trimmedPath) return "";

  return trimmedPath
    .replace(/^(\\\\[?.]\\\\)([a-z]):/i, (_fullMatch, prefix, driveLetter) => (
      `${prefix}${driveLetter.toUpperCase()}:`
    ))
    .replace(/^([a-z]):/, (_fullMatch, driveLetter) => `${driveLetter.toUpperCase()}:`);
}

// Leaving the tab's workspace from its primary Filesystem pane clears the workspace
// context, so that asks first.
export default function useWorkspaceExitNavigation({
  tabId,
  isPrimaryFilesystemPane,
  tabWorkspaceRoot,
  openConfirm,
  navigateToPath,
  onOpenFolderInCurrentTab,
}) {
  const navigateWithExitConfirm = useCallback(async (nextPath) => {
    const staysInWorkspace = !isPrimaryFilesystemPane
      || !tabWorkspaceRoot
      || isPathInsideRoot(nextPath, tabWorkspaceRoot);
    if (!staysInWorkspace) {
      const shouldLeaveWorkspace = await openConfirm({
        title: "Leave workspace?",
        message: "This will clear workspace context for this tab.",
        tone: "warning",
        confirmLabel: "Leave workspace",
        cancelLabel: "Stay",
      });
      if (!shouldLeaveWorkspace) return;
    }
    navigateToPath(nextPath);
  }, [isPrimaryFilesystemPane, navigateToPath, openConfirm, tabWorkspaceRoot]);

  // Typed and recent folders. With `options.fallbackPath`, the fallback opens when the
  // path itself can't be.
  const openFolderPath = useCallback(async (nextPath, options = {}) => {
    const normalizedPath = normalizeDriveLetterPath(nextPath);
    if (!normalizedPath) return;
    const fallbackPath = normalizeDriveLetterPath(options?.fallbackPath);
    const hasFallbackPath = Boolean(fallbackPath) && !isSamePath(fallbackPath, normalizedPath);

    if (typeof onOpenFolderInCurrentTab === "function") {
      if (!hasFallbackPath) {
        await onOpenFolderInCurrentTab(tabId, normalizedPath);
        return;
      }
      const openedPrimary = await onOpenFolderInCurrentTab(tabId, normalizedPath, {
        suppressNotFoundNotification: true,
      });
      if (openedPrimary !== false) return;
      await onOpenFolderInCurrentTab(tabId, fallbackPath, {
        suppressNotFoundNotification: false,
      });
      return;
    }

    await navigateWithExitConfirm(hasFallbackPath ? fallbackPath : normalizedPath);
  }, [navigateWithExitConfirm, onOpenFolderInCurrentTab, tabId]);

  return { navigateWithExitConfirm, openFolderPath };
}
