import { PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useState } from "react";
import {
  getBreadcrumbDndId,
  parseDestinationTarget,
  parseEntryPath,
} from "../dndIds";

function useFilesystemDnd({ entries, currentPath, isMovingEntry, moveEntry }) {
  const [activeDragPath, setActiveDragPath] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
  );

  function getBreadcrumbDropId(path) {
    return getBreadcrumbDndId(path);
  }

  function handleDragStart(event) {
    setActiveDragPath(parseEntryPath(event.active?.id));
  }

  async function handleDragEnd(event) {
    const sourcePath = parseEntryPath(event.active?.id);
    const destinationTarget = parseDestinationTarget(event.over?.id);
    const destinationDir = destinationTarget.path;

    setActiveDragPath("");

    if (
      isMovingEntry ||
      !sourcePath ||
      !destinationDir ||
      sourcePath === destinationDir ||
      destinationDir === currentPath
    ) {
      return;
    }

    if (destinationTarget.kind === "entry") {
      const destinationEntry = entries.find((entry) => entry.path === destinationDir);
      if (!destinationEntry?.is_dir) {
        return;
      }
    }

    try {
      await moveEntry(sourcePath, destinationDir);
    } catch {
      // moveEntry already sets user-facing error state
    }
  }

  function handleDragCancel() {
    setActiveDragPath("");
  }

  return {
    sensors,
    activeDragPath,
    getBreadcrumbDropId,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  };
}

export default useFilesystemDnd;
