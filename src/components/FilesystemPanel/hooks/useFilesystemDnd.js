import { useEffect, useMemo, useRef, useState } from "react";
import {
  getBreadcrumbDndId,
  getPanelDndId,
  parseDestinationTarget,
  parseEntryPath,
} from "../dndIds";
import {
  emitExternalFilesystemDragStart,
  EXTERNAL_FILESYSTEM_DRAG_START_EVENT,
} from "../../dndExternalEvents";
import { uniqueNonEmptyPaths } from "../../../utils/pathSelection";

const PENDING_EXTERNAL_DRAG_TTL_MS = 15000;

function normalizePathForMatch(path) {
  if (typeof path !== "string") return "";
  const trimmedPath = path.trim();
  if (!trimmedPath) return "";

  const withoutDevicePrefix = trimmedPath
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\/\/\?\/UNC\//i, "\\\\")
    .replace(/^\\\\\?\\/, "")
    .replace(/^\/\/\?\//, "")
    .replace(/^\\\\\.\\/, "")
    .replace(/^\/\/\.\//, "");
  return withoutDevicePrefix
    .replace(/[\\/]+/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function useFilesystemDnd({
  paneId = "",
  entries,
  entryParentByPath = {},
  selectedPaths,
  isMovingEntry,
  onDropTransfer = undefined,
}) {
  const [activeDragPaths, setActiveDragPaths] = useState([]);
  const [ownedDragPaths, setOwnedDragPaths] = useState([]);
  const [activeDropDestinationPath, setActiveDropDestinationPath] = useState("");
  const [isCopyIntent, setIsCopyIntent] = useState(false);
  const [externalDragMode, setExternalDragMode] = useState("move");
  const externalDragStartedRef = useRef(false);
  const pendingExternalDragSourcePathsRef = useRef([]);
  const pendingExternalDragStartedAtMsRef = useRef(0);
  const copyModifierPressedRef = useRef(false);
  const modifierTrackingCleanupRef = useRef(null);
  const entryByPath = useMemo(() => {
    const byPath = new Map();
    entries.forEach((entry) => byPath.set(entry.path, entry));
    return byPath;
  }, [entries]);

  function clearDragState() {
    setActiveDragPaths([]);
    setOwnedDragPaths([]);
    setActiveDropDestinationPath("");
  }

  function clearPendingExternalDragSourcePaths() {
    pendingExternalDragSourcePathsRef.current = [];
    pendingExternalDragStartedAtMsRef.current = 0;
  }

  function setPendingExternalDragSourcePaths(paths) {
    const normalizedPaths = uniqueNonEmptyPaths(paths);
    pendingExternalDragSourcePathsRef.current = normalizedPaths;
    pendingExternalDragStartedAtMsRef.current = normalizedPaths.length > 0 ? Date.now() : 0;
  }

  function getPendingExternalDragSourcePaths() {
    const startedAtMs = pendingExternalDragStartedAtMsRef.current;
    const pendingPaths = pendingExternalDragSourcePathsRef.current;
    if (pendingPaths.length === 0 || !startedAtMs) return [];

    if (Date.now() - startedAtMs > PENDING_EXTERNAL_DRAG_TTL_MS) {
      clearPendingExternalDragSourcePaths();
      return [];
    }

    return pendingPaths;
  }

  function startModifierTracking(initialCtrlKey = false) {
    stopModifierTracking();
    const initialCopyIntent = Boolean(initialCtrlKey);
    copyModifierPressedRef.current = initialCopyIntent;
    setIsCopyIntent(initialCopyIntent);
    setExternalDragMode(initialCopyIntent ? "copy" : "move");
    if (typeof window === "undefined") return;

    const updateModifier = (event) => {
      const nextCopyIntent = Boolean(event.ctrlKey);
      copyModifierPressedRef.current = nextCopyIntent;
      setIsCopyIntent(nextCopyIntent);
      setExternalDragMode(nextCopyIntent ? "copy" : "move");
    };
    const clearModifier = () => {
      copyModifierPressedRef.current = false;
      setIsCopyIntent(false);
      setExternalDragMode("move");
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
    setIsCopyIntent(false);
    setExternalDragMode("move");
  }

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleExternalDragStart = () => {
      externalDragStartedRef.current = true;
      clearDragState();
      stopModifierTracking();
    };

    window.addEventListener(EXTERNAL_FILESYSTEM_DRAG_START_EVENT, handleExternalDragStart);
    return () => {
      window.removeEventListener(EXTERNAL_FILESYSTEM_DRAG_START_EVENT, handleExternalDragStart);
    };
  }, []);

  function getEventSourcePath(event) {
    return event?.active?.data?.current?.sourcePath || parseEntryPath(event?.active?.id);
  }

  function isEventOwnedByPane(event) {
    const sourcePaneId = event?.active?.data?.current?.sourcePaneId;
    if (typeof sourcePaneId !== "string" || sourcePaneId.length === 0) return true;
    return sourcePaneId === paneId;
  }

  function resolveDragSourcePaths(sourcePath) {
    if (!sourcePath || !entryByPath.has(sourcePath)) return [];

    const normalizedSelection = uniqueNonEmptyPaths(selectedPaths).filter(
      (path) => entryByPath.has(path),
    );
    if (!normalizedSelection.includes(sourcePath)) return [sourcePath];
    return normalizedSelection;
  }

  function handleDragStart(event) {
    externalDragStartedRef.current = false;
    clearPendingExternalDragSourcePaths();
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
    if (externalDragStartedRef.current) {
      setActiveDropDestinationPath("");
      return;
    }

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
    if (!isOwner) return;

    if (externalDragStartedRef.current) {
      externalDragStartedRef.current = false;
      return;
    }

    if (isMovingEntry || actionableSourcePaths.length === 0 || !canDropIntoDestination) return;

    try {
      await onDropTransfer?.({
        sourcePaths: actionableSourcePaths,
        destinationDir,
        shouldCopy,
      });
    } catch {
      // Entry operations handle user-facing notifications on failure.
    }
  }

  function handleDragCancel() {
    clearDragState();
    stopModifierTracking();
    if (externalDragStartedRef.current) {
      externalDragStartedRef.current = false;
      return;
    }

    clearPendingExternalDragSourcePaths();
  }

  function markExternalDragStart(sourcePaths = []) {
    setPendingExternalDragSourcePaths(sourcePaths);
    externalDragStartedRef.current = true;
    clearDragState();
    stopModifierTracking();
    emitExternalFilesystemDragStart();
  }

  function clearExternalDragStart() {
    externalDragStartedRef.current = false;
    clearDragState();
    stopModifierTracking();
    clearPendingExternalDragSourcePaths();
  }

  function consumeMatchingExternalDragSourcePaths(dropPaths) {
    const normalizedDropPaths = uniqueNonEmptyPaths(dropPaths);
    if (normalizedDropPaths.length === 0) return [];

    const pendingSourcePaths = getPendingExternalDragSourcePaths();
    if (pendingSourcePaths.length === 0) return [];

    const pendingPathByKey = new Map();
    pendingSourcePaths.forEach((sourcePath) => pendingPathByKey.set(normalizePathForMatch(sourcePath), sourcePath));

    const matchedPendingPaths = normalizedDropPaths.map((path) => {
      const normalizedPath = normalizePathForMatch(path);
      return pendingPathByKey.get(normalizedPath) ?? "";
    }).filter(Boolean);
    if (matchedPendingPaths.length !== normalizedDropPaths.length) return [];

    clearPendingExternalDragSourcePaths();
    return uniqueNonEmptyPaths(matchedPendingPaths);
  }

  return {
    activeDragPaths,
    activeDropDestinationPath,
    isCopyIntent,
    externalDragMode,
    externalDragPaths: ownedDragPaths,
    getBreadcrumbDropId: getBreadcrumbDndId,
    getPanelDropId: getPanelDndId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    markExternalDragStart,
    clearExternalDragStart,
    consumeMatchingExternalDragSourcePaths,
  };
}

export default useFilesystemDnd;
