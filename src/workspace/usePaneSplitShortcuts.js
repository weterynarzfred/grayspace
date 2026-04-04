import { useEffect } from "react";
import { COMMAND_IDS, isCommandShortcutMatch } from "../commands/commandRegistry";
import isEditableKeyboardTarget from "../utils/isEditableKeyboardTarget";

export default function usePaneSplitShortcuts(onShortcutCommand) {
  useEffect(() => {
    const handleKeyDown = event => {
      if (event.defaultPrevented || event.repeat) return;
      if (isEditableKeyboardTarget(event.target)) return;
      const isVertical = isCommandShortcutMatch(COMMAND_IDS.PANE_SPLIT_VERTICAL, event);
      const isHorizontal = isCommandShortcutMatch(COMMAND_IDS.PANE_SPLIT_HORIZONTAL, event);
      if (!isVertical && !isHorizontal) return;

      event.preventDefault();
      onShortcutCommand?.(
        isVertical ? COMMAND_IDS.PANE_SPLIT_VERTICAL : COMMAND_IDS.PANE_SPLIT_HORIZONTAL,
        { source: "shortcut" },
      );
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onShortcutCommand]);
}
