import { useRef, useState } from "react";
import {
  getBreadcrumbDndId,
  getPanelDndId,
  parseDestinationTarget,
  parseEntryPath,
} from "../dndIds";
import { uniqueNonEmptyPaths } from "../../../utils/pathSelection";

function useFilesystemDnd({
  paneId = "",
  entries,
  selectedPaths,
  currentPath,
  isMovingEntry,
  moveEntries,
  copyEntries,
}) {
  const [activeDragPaths, setActiveDragPaths] = useState([]);
  const [ownedDragPaths, setOwnedDragPaths] = useState([]);
  const externalDragStartedRef = useRef(false);
  const copyModifierPressedRef = useRef(false);
  const modifierTrackingCleanupRef = useRef(null);

  function clearDragState() {
    setActiveDragPaths([]);
    setOwnedDragPaths([]);
  }

  function startModifierTracking(initialCtrlKey = false) {
    stopModifierTracking();
    copyModifierPressedRef.current = Boolean(initialCtrlKey);
    if (typeof window === "undefined") return;

    const updateModifier = (event) => {
      copyModifierPressedRef.current = Boolean(event?.ctrlKey);
    };
    const clearModifier = () => {
      copyModifierPressedRef.current = false;
    };

    window.addEventListener("keydown", updateModifier, true);
    window.addEventListener("keyup", updateModifier, true);
    window.addEventListener("pointerup", updateModifier, true);
    window.addEventListener("blur", clearModifier, true);
    modifierTrackingCleanupRef.current = () => {
      window.removeEventListener("keydown", updateModifier, true);
      window.removeEventListener("keyup", updateModifier, true);
      window.removeEventListener("pointerup", updateModifier, true);
      window.removeEventListener("blur", clearModifier, true);
    };
  }

  function stopModifierTracking() {
    modifierTrackingCleanupRef.current?.();
    modifierTrackingCleanupRef.current = null;
    copyModifierPressedRef.current = false;
  }

  function getEventSourcePath(event) {
    const sourcePathFromData = event?.active?.data?.current?.sourcePath;
    if (typeof sourcePathFromData === "string" && sourcePathFromData) {
      return sourcePathFromData;
    }

    return parseEntryPath(event?.active?.id);
  }

  function isEventOwnedByPane(event) {
    const sourcePaneId = event?.active?.data?.current?.sourcePaneId;
    if (typeof sourcePaneId !== "string" || sourcePaneId.length === 0) {
      return true;
    }

    return sourcePaneId === paneId;
  }

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

  function getPanelDropId(path) {
    return getPanelDndId(path);
  }

  function getDestinationTarget(event) {
    const destinationTarget = parseDestinationTarget(event?.over?.id);
    const overData = event?.over?.data?.current;
    if (!overData || typeof overData !== "object") {
      return destinationTarget;
    }

    const dataPath = typeof overData.path === "string" ? overData.path : "";
    const dataKind = typeof overData.kind === "string" ? overData.kind : "";
    if (!dataPath || !dataKind) {
      return destinationTarget;
    }

    const isDirectory = typeof overData.isDirectory === "boolean"
      ? overData.isDirectory
      : undefined;

    return {
      kind: dataKind,
      path: dataPath,
      isDirectory,
    };
  }

  function handleDragStart(event) {
    externalDragStartedRef.current = false;
    const sourcePath = getEventSourcePath(event);
    if (!sourcePath) {
      clearDragState();
      return;
    }

    if (!isEventOwnedByPane(event)) {
      // Non-owner panes still track the dragged source for drop-target visuals.
      setActiveDragPaths([sourcePath]);
      setOwnedDragPaths([]);
      return;
    }

    const sourcePaths = resolveDragSourcePaths(sourcePath);
    setOwnedDragPaths(sourcePaths);
    setActiveDragPaths(sourcePaths);
    startModifierTracking(event?.activatorEvent?.ctrlKey);
  }

  async function handleDragEnd(event) {
    const isOwner = isEventOwnedByPane(event);
    const sourcePath = getEventSourcePath(event);
    const sourcePaths = ownedDragPaths.length > 0
      ? ownedDragPaths
      : resolveDragSourcePaths(sourcePath);
    const destinationTarget = getDestinationTarget(event);
    const destinationDir = destinationTarget.path;
    const shouldCopy = copyModifierPressedRef.current
      || event?.activatorEvent?.ctrlKey === true;
    const localDestinationEntry = entries.find((entry) => entry.path === destinationDir);
    const isDestinationDirectory = destinationTarget.kind !== "entry"
      || destinationTarget.isDirectory === true
      || localDestinationEntry?.is_dir === true;

    clearDragState();
    stopModifierTracking();
    if (!isOwner) {
      return;
    }

    if (externalDragStartedRef.current) {
      externalDragStartedRef.current = false;
      return;
    }

    if (
      isMovingEntry ||
      sourcePaths.length === 0 ||
      !destinationDir ||
      !isDestinationDirectory ||
      sourcePaths.includes(destinationDir) ||
      destinationDir === currentPath
    ) {
      return;
    }

    try {
      if (shouldCopy && typeof copyEntries === "function") {
        await copyEntries(sourcePaths, destinationDir);
      } else {
        await moveEntries(sourcePaths, destinationDir);
      }
    } catch {
      // moveEntries already sets user-facing error state.
    }
  }

  function handleDragCancel() {
    clearDragState();
    externalDragStartedRef.current = false;
    stopModifierTracking();
  }

  function markExternalDragStart() {
    externalDragStartedRef.current = true;
    clearDragState();
    stopModifierTracking();
  }

  function clearExternalDragStart() {
    externalDragStartedRef.current = false;
    clearDragState();
    stopModifierTracking();
  }

  return {
    activeDragPaths,
    externalDragPaths: ownedDragPaths,
    getBreadcrumbDropId,
    getPanelDropId,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    markExternalDragStart,
    clearExternalDragStart,
  };
}

export default useFilesystemDnd;
