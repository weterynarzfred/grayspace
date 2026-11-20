import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  cancelAllFilesystemOperations,
  hasFilesystemOperations,
} from "../components/FilesystemPanel/operations/filesystemOperationQueue";

// The window's file operations live in its JS and die with it. So a close (the × button, Alt+F4,
// the taskbar) with some running or waiting asks first, then cancels them and waits until the
// running ones have stopped, so their cleanup runs: partial copies removed, Replace staging undone.
// While this listener exists every close of the window comes here, Rust's own too, and Tauri's
// wrapper destroys the window (core:window:allow-destroy) only once the handler returns without
// throwing. Nothing below throws: the confirm and the cancel only ever resolve.
export default function useWindowCloseGuard(openConfirm) {
  useEffect(() => {
    // From the question until the window is kept. Each close request has its own wrapper, which
    // would destroy the window in the middle of the first one's wait, so another is prevented.
    let isClosing = false;
    const unlistenPromise = getCurrentWindow().onCloseRequested(async (event) => {
      if (!hasFilesystemOperations()) return;
      if (isClosing) {
        event.preventDefault();
        return;
      }
      isClosing = true;
      const shouldClose = await openConfirm({
        title: "Cancel file operations?",
        message: "File operations in this window are still running or waiting. Closing the window cancels them.",
        tone: "warning",
        confirmLabel: "Cancel them and close",
        cancelLabel: "Keep window",
      });
      if (!shouldClose) {
        isClosing = false;
        event.preventDefault();
        return;
      }
      await cancelAllFilesystemOperations();
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [openConfirm]);
}
