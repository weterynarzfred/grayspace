import { useEffect } from "react";
import isEditableKeyboardTarget from "../utils/isEditableKeyboardTarget";

export default function usePaneSplitShortcuts(onSplitActivePane) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented || event.repeat) return;
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (isEditableKeyboardTarget(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "v") {
        event.preventDefault();
        onSplitActivePane?.("right");
      } else if (key === "h") {
        event.preventDefault();
        onSplitActivePane?.("bottom");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onSplitActivePane]);
}
