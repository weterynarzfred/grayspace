import { useCallback, useState } from "react";
import {
  getRangeSelectionPaths,
  sortPathsByEntryOrder,
} from "./filesystemNavigationUtils";

export default function useFilesystemSelectionState({
  initialSelectedPaths = [],
  initialSelectionAnchorPath = "",
}) {
  const [selectedPaths, setSelectedPaths] = useState(initialSelectedPaths);
  const [selectionAnchorPath, setSelectionAnchorPath] = useState(initialSelectionAnchorPath);
  // Where the arrow keys move from: the item last clicked or moved to. After Shift+Up that is the
  // top of the range, while the selection, kept in entry order, ends at the anchor.
  const [selectionFocusPath, setSelectionFocusPath] = useState(initialSelectionAnchorPath);

  const clearSelection = useCallback(() => {
    setSelectedPaths([]);
    setSelectionAnchorPath("");
    setSelectionFocusPath("");
  }, []);

  const keepSelectionWhere = useCallback((isKept) => {
    setSelectedPaths((previousSelection) => previousSelection.filter((path) => isKept(path)));
    setSelectionAnchorPath((previousAnchorPath) => (
      isKept(previousAnchorPath) ? previousAnchorPath : ""
    ));
    setSelectionFocusPath((previousFocusPath) => (
      isKept(previousFocusPath) ? previousFocusPath : ""
    ));
  }, []);

  const removeSelectionPaths = useCallback((excludedPathSet) => {
    setSelectedPaths((previousSelection) => (
      previousSelection.filter((path) => !excludedPathSet.has(path))
    ));
    setSelectionAnchorPath((previousAnchorPath) => (
      excludedPathSet.has(previousAnchorPath) ? "" : previousAnchorPath
    ));
    setSelectionFocusPath((previousFocusPath) => (
      excludedPathSet.has(previousFocusPath) ? "" : previousFocusPath
    ));
  }, []);

  const setSelectedPath = useCallback((path) => {
    const nextPath = typeof path === "string" ? path : "";
    if (!nextPath) {
      clearSelection();
      return [];
    }

    setSelectedPaths([nextPath]);
    setSelectionAnchorPath(nextPath);
    setSelectionFocusPath(nextPath);
    return [nextPath];
  }, [clearSelection]);

  const selectEntry = useCallback((entryPath, entryPaths, selectedEntryPaths, options = {}) => {
    const { additive = false, range = false } = options;
    if (typeof entryPath !== "string" || !entryPath) return selectedEntryPaths;
    if (!Array.isArray(entryPaths) || !entryPaths.includes(entryPath)) return selectedEntryPaths;

    setSelectionFocusPath(entryPath);
    if (range) {
      const anchorPath = entryPaths.includes(selectionAnchorPath)
        ? selectionAnchorPath
        : entryPath;
      const rangePaths = getRangeSelectionPaths(entryPaths, anchorPath, entryPath);
      const nextSelection = additive
        ? sortPathsByEntryOrder([...selectedEntryPaths, ...rangePaths], entryPaths)
        : rangePaths;
      setSelectedPaths(nextSelection);
      setSelectionAnchorPath(anchorPath);
      return nextSelection;
    }

    if (additive) {
      const isAlreadySelected = selectedEntryPaths.includes(entryPath);
      const nextSelection = isAlreadySelected
        ? selectedEntryPaths.filter((path) => path !== entryPath)
        : sortPathsByEntryOrder([...selectedEntryPaths, entryPath], entryPaths);
      setSelectedPaths(nextSelection);
      setSelectionAnchorPath(entryPath);
      return nextSelection;
    }

    const nextSelection = [entryPath];
    setSelectedPaths(nextSelection);
    setSelectionAnchorPath(entryPath);
    return nextSelection;
  }, [selectionAnchorPath]);

  return {
    selectedPaths,
    selectionFocusPath,
    clearSelection,
    keepSelectionWhere,
    removeSelectionPaths,
    setSelectedPath,
    selectEntry,
  };
}
