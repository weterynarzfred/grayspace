import { useMemo, useRef, useState } from "react";
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
  entryParentByPath = {},
  selectedPaths,
  isMovingEntry,
  moveEntries,
  copyEntries,
}) {
  const [activeDragPaths, setActiveDragPaths] = useState([]);
  const [ownedDragPaths, setOwnedDragPaths] = useState([]);
  const [activeDropDestinationPath, setActiveDropDestinationPath] = useState("");
  const externalDragStartedRef = useRef(false);
  const copyModifierPressedRef = useRef(false);
  const modifierTrackingCleanupRef = useRef(null);
  const entryByPath = useMemo(() => {
    const byPath = new Map();
    entries.forEach((entry) => {
      byPath.set(entry.path, entry);
    });
    return byPath;
  }, [entries]);

  function clearDragState() {
    setActiveDragPaths([]);
    setOwnedDragPaths([]);
    setActiveDropDestinationPath("");
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

  function getDestinationTarget(event) {
    const destinationTarget = parseDestinationTarget(event?.over?.id);
    const overData = event?.over?.data?.current;
    if (overData && typeof overData === "object") {
      const dataPath = typeof overData.path === "string" ? overData.path : "";
      const dataKind = typeof overData.kind === "string" ? overData.kind : "";
      if (dataPath && dataKind) {
        const isDirectory = typeof overData.isDirectory === "boolean"
          ? overData.isDirectory
          : undefined;
        return {
          kind: dataKind,
          path: dataPath,
          isDirectory,
        };
      }
    }

    if (destinationTarget.kind !== "entry" || !destinationTarget.path) {
      return destinationTarget;
    }

    const destinationEntry = entryByPath.get(destinationTarget.path);
    if (destinationEntry?.is_dir) {
      return {
        kind: "entry",
        path: destinationEntry.path,
        isDirectory: true,
      };
    }

    const parentPath = entryParentByPath[destinationTarget.path];
    if (parentPath) {
      return {
        kind: "entry",
        path: parentPath,
        isDirectory: true,
      };
    }

    return destinationTarget;
  }

  function getActionableSourcePaths(sourcePaths, destinationDir) {
    if (!destinationDir || sourcePaths.length === 0) return [];

    return sourcePaths.filter((sourcePath) => {
      if (!sourcePath || sourcePath === destinationDir) return false;
      const sourceParent = entryParentByPath[sourcePath];
      if (sourceParent && sourceParent === destinationDir) return false;
      return true;
    });
  }

  function resolveDragPathsForEvent(event) {
    const sourcePath = getEventSourcePath(event);
    if (!sourcePath) return activeDragPaths;
    if (ownedDragPaths.length > 0) return ownedDragPaths;
    const resolvedSourcePaths = resolveDragSourcePaths(sourcePath);
    if (resolvedSourcePaths.length > 0) return resolvedSourcePaths;
    return activeDragPaths.length > 0 ? activeDragPaths : [sourcePath];
  }

  function isDestinationDirectory(destinationTarget) {
    const destinationDir = destinationTarget.path;
    if (!destinationDir) return false;
    if (destinationTarget.kind !== "entry") return true;
    if (destinationTarget.isDirectory === true) return true;
    return entryByPath.get(destinationDir)?.is_dir === true;
  }

  function handleDragOver(event) {
    const sourcePaths = resolveDragPathsForEvent(event);
    if (sourcePaths.length === 0) {
      setActiveDropDestinationPath("");
      return;
    }

    const destinationTarget = getDestinationTarget(event);
    const destinationDir = destinationTarget.path;
    if (!isDestinationDirectory(destinationTarget)) {
      setActiveDropDestinationPath("");
      return;
    }

    const actionableSourcePaths = getActionableSourcePaths(sourcePaths, destinationDir);
    setActiveDropDestinationPath(actionableSourcePaths.length > 0 ? destinationDir : "");
  }

  async function handleDragEnd(event) {
    const isOwner = isEventOwnedByPane(event);
    const sourcePaths = resolveDragPathsForEvent(event);
    const destinationTarget = getDestinationTarget(event);
    const destinationDir = destinationTarget.path;
    const shouldCopy = copyModifierPressedRef.current
      || event?.activatorEvent?.ctrlKey === true;
    const actionableSourcePaths = getActionableSourcePaths(sourcePaths, destinationDir);
    const canDropIntoDestination = isDestinationDirectory(destinationTarget);

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
      isMovingEntry
      || actionableSourcePaths.length === 0
      || !canDropIntoDestination
    ) {
      return;
    }

    try {
      if (shouldCopy && typeof copyEntries === "function") {
        await copyEntries(actionableSourcePaths, destinationDir);
      } else {
        await moveEntries(actionableSourcePaths, destinationDir);
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
    activeDropDestinationPath,
    externalDragPaths: ownedDragPaths,
    getBreadcrumbDropId,
    getPanelDropId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    markExternalDragStart,
    clearExternalDragStart,
  };
}

export default useFilesystemDnd;
