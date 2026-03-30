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

  const clearSelection = useCallback(() => {
    setSelectedPaths([]);
    setSelectionAnchorPath("");
  }, []);

  const keepSelectionOnlyInPathSet = useCallback((allowedPathSet) => {
    setSelectedPaths((previousSelection) => (
      previousSelection.filter((path) => allowedPathSet.has(path))
    ));
    setSelectionAnchorPath((previousAnchorPath) => (
      allowedPathSet.has(previousAnchorPath) ? previousAnchorPath : ""
    ));
  }, []);

  const removeSelectionPaths = useCallback((excludedPathSet) => {
    setSelectedPaths((previousSelection) => (
      previousSelection.filter((path) => !excludedPathSet.has(path))
    ));
    setSelectionAnchorPath((previousAnchorPath) => (
      excludedPathSet.has(previousAnchorPath) ? "" : previousAnchorPath
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
    return [nextPath];
  }, [clearSelection]);

  const selectEntry = useCallback((entryPath, options = {}, entryPaths, selectedEntryPaths) => {
    const { additive = false, range = false } = options;
    if (typeof entryPath !== "string" || !entryPath) return selectedEntryPaths;
    if (!Array.isArray(entryPaths) || !entryPaths.includes(entryPath)) return selectedEntryPaths;

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
    clearSelection,
    keepSelectionOnlyInPathSet,
    removeSelectionPaths,
    setSelectedPath,
    selectEntry,
  };
}
