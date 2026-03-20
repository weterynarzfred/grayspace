import { useRef, useState } from "react";
import {
  getBreadcrumbDndId,
  parseDestinationTarget,
  parseEntryPath,
} from "../dndIds";
import { uniqueNonEmptyPaths } from "../pathSelection";

function useFilesystemDnd({
  entries,
  selectedPaths,
  currentPath,
  isMovingEntry,
  moveEntries,
}) {
  const [activeDragPaths, setActiveDragPaths] = useState([]);
  const externalDragStartedRef = useRef(false);

  function resolveDragSourcePaths(sourcePath) {
    const entryPathSet = new Set(entries.map((entry) => entry.path));
    if (!sourcePath || !entryPathSet.has(sourcePath)) {
      return [];
    }

    const normalizedSelection = uniqueNonEmptyPaths(selectedPaths).filter(
      (path) => entryPathSet.has(path),
    );
    if (!normalizedSelection.includes(sourcePath)) {
      return [sourcePath];
    }

    return normalizedSelection;
  }

  function getBreadcrumbDropId(path) {
    return getBreadcrumbDndId(path);
  }

  function handleDragStart(event) {
    const sourcePath = parseEntryPath(event.active?.id);
    externalDragStartedRef.current = false;
    setActiveDragPaths(resolveDragSourcePaths(sourcePath));
  }

  async function handleDragEnd(event) {
    const sourcePath = parseEntryPath(event.active?.id);
    const sourcePaths = activeDragPaths.length > 0
      ? activeDragPaths
      : resolveDragSourcePaths(sourcePath);
    const destinationTarget = parseDestinationTarget(event.over?.id);
    const destinationDir = destinationTarget.path;

    setActiveDragPaths([]);
    if (externalDragStartedRef.current) {
      externalDragStartedRef.current = false;
      return;
    }

    if (
      isMovingEntry ||
      sourcePaths.length === 0 ||
      !destinationDir ||
      sourcePaths.includes(destinationDir) ||
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
      await moveEntries(sourcePaths, destinationDir);
    } catch {
      // moveEntries already sets user-facing error state.
    }
  }

  function handleDragCancel() {
    setActiveDragPaths([]);
    externalDragStartedRef.current = false;
  }

  function markExternalDragStart() {
    externalDragStartedRef.current = true;
    setActiveDragPaths([]);
  }

  function clearExternalDragStart() {
    externalDragStartedRef.current = false;
    setActiveDragPaths([]);
  }

  return {
    activeDragPaths,
    getBreadcrumbDropId,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    markExternalDragStart,
    clearExternalDragStart,
  };
}

export default useFilesystemDnd;
