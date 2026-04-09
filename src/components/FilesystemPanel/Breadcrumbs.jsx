import { useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatRecentFolderOpenedAtLabel,
  normalizeRecentFolderEntries,
} from "../popovers/recentFoldersShared";
import { fuzzyFilterEntries } from "../popovers/fuzzySearch";
import { isSamePath } from "../../utils/pathWatch";
import styles from "./Breadcrumbs.module.scss";

export function buildBreadcrumbs(currentPath, currentDrive) {
  if (!currentPath || !currentDrive) return [];

  const separator = currentDrive.includes("\\") ? "\\" : "/";
  const driveRoot = currentDrive.replace(/[\\/]+$/, "");
  const normalizedCurrentPath = currentPath.replace(/[\\/]+$/, "");

  const crumbs = [
    { label: "Drives", path: "" },
    { label: driveRoot, path: currentDrive },
  ];

  const remainder = normalizedCurrentPath.slice(driveRoot.length).replace(/^[\\/]+/, "");

  if (!remainder) return crumbs;

  let runningPath = driveRoot;
  const parts = remainder.split(/[\\/]+/).filter(Boolean);

  for (const part of parts) {
    runningPath = `${runningPath}${separator}${part}`;
    crumbs.push({ label: part, path: runningPath });
  }

  return crumbs;
}

function StaticCrumbButton({ crumb, onSelect, isWorkspaceFolder = false }) {
  return <button
    type="button"
    className={`${styles.crumbButton} ${isWorkspaceFolder ? styles.workspaceCrumb : ""}`}
    data-drop-destination-path={crumb.path || undefined}
    data-contextmenu-boundary="breadcrumb"
    data-context-kind="breadcrumb"
    data-context-id={crumb.path || crumb.label}
    data-context-label={crumb.label}
    data-context-path={crumb.path || undefined}
    onClick={() => onSelect(crumb.path)}
  >
    <span>{crumb.label}</span>
  </button>;
}

function DroppableCrumbButton({
  crumb,
  index,
  onSelect,
  isMovingEntry,
  activeDragPaths,
  dropId,
  isWorkspaceFolder = false,
}) {
  const hasDestinationPath = Boolean(crumb.path);
  const { isOver, setNodeRef } = useDroppable({
    id: dropId || `breadcrumb-disabled-${index}`,
    disabled: !hasDestinationPath || isMovingEntry,
  });
  const isDropTarget =
    hasDestinationPath &&
    isOver &&
    activeDragPaths.length > 0 &&
    !activeDragPaths.includes(crumb.path);

  return <button
    ref={setNodeRef}
    type="button"
    className={`${styles.crumbButton} ${isWorkspaceFolder ? styles.workspaceCrumb : ""} ${isDropTarget ? styles.dropTarget : ""}`}
    data-drop-destination-path={crumb.path || undefined}
    data-contextmenu-boundary="breadcrumb"
    data-context-kind="breadcrumb"
    data-context-id={crumb.path || crumb.label}
    data-context-label={crumb.label}
    data-context-path={crumb.path || undefined}
    onClick={() => onSelect(crumb.path)}
  >
    <span>{crumb.label}</span>
  </button>;
}

function Breadcrumbs({
  currentPath,
  currentDrive,
  onSelect,
  onPathSubmit,
  activeDragPaths = [],
  isMovingEntry = false,
  getDropIdForPath,
  workspaceFolderPathSet = new Set(),
  recentFoldersEntries = [],
  isLoadingRecentFolders = false,
  onSelectRecentFolder,
  loadSubfoldersForPath,
  focusPathInputRequestKey = 0,
}) {
  const arePathsEquivalent = useCallback((leftPath, rightPath) => {
    const normalizedLeft = typeof leftPath === "string" ? leftPath.trim().toLowerCase() : "";
    const normalizedRight = typeof rightPath === "string" ? rightPath.trim().toLowerCase() : "";
    return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
  }, []);
  const hasPathLookupResult = useCallback((lookupByParent, parentPath) => (
    Object.prototype.hasOwnProperty.call(lookupByParent, parentPath)
  ), []);
  const getPathLeafName = useCallback((path) => {
    if (typeof path !== "string") return "";
    const normalizedPath = path.trim().replace(/[\\/]+$/, "");
    if (!normalizedPath) return "";
    const separatorIndex = Math.max(
      normalizedPath.lastIndexOf("\\"),
      normalizedPath.lastIndexOf("/"),
    );
    if (separatorIndex < 0) return normalizedPath;
    return normalizedPath.slice(separatorIndex + 1);
  }, []);
  const normalizeLookupParentPath = useCallback((rawParentPath) => {
    if (typeof rawParentPath !== "string") return "";
    const trimmedParentPath = rawParentPath.trim();
    if (!trimmedParentPath) return "";
    if (/^[A-Za-z]:[\\/]?$/.test(trimmedParentPath)) {
      return `${trimmedParentPath.slice(0, 2)}\\`;
    }
    if (/^\/+$/.test(trimmedParentPath)) return "/";
    return trimmedParentPath.replace(/[\\/]+$/, "");
  }, []);
  const parsePathLookupContext = useCallback((rawQuery) => {
    const normalizedQuery = typeof rawQuery === "string" ? rawQuery.trim() : "";
    if (!normalizedQuery) return null;
    const separatorIndex = Math.max(
      normalizedQuery.lastIndexOf("\\"),
      normalizedQuery.lastIndexOf("/"),
    );
    if (separatorIndex < 0) return null;
    const parentPath = normalizeLookupParentPath(normalizedQuery.slice(0, separatorIndex + 1));
    if (!parentPath) return null;
    return {
      parentPath,
      childQuery: normalizedQuery.slice(separatorIndex + 1).trim(),
    };
  }, [normalizeLookupParentPath]);
  const normalizeFolderSuggestionPaths = useCallback((folderPaths = []) => {
    const uniquePaths = [];
    folderPaths.forEach((path) => {
      if (typeof path !== "string") return;
      const normalizedPath = path.trim();
      if (!normalizedPath) return;
      if (uniquePaths.some((candidatePath) => isSamePath(candidatePath, normalizedPath))) return;
      uniquePaths.push(normalizedPath);
    });
    return uniquePaths;
  }, []);
  const [isPathEditing, setIsPathEditing] = useState(false);
  const [isPathInputFocused, setIsPathInputFocused] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  const [pathSearchQuery, setPathSearchQuery] = useState("");
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [folderSuggestionsByParentPath, setFolderSuggestionsByParentPath] = useState({});
  const folderSuggestionRequestIdRef = useRef(0);
  const lastFocusRequestKeyRef = useRef(0);
  const pathInputRef = useRef(null);
  const crumbs = buildBreadcrumbs(currentPath, currentDrive);
  const hasDropTargets = typeof getDropIdForPath === "function";
  const normalizedRecentFolders = useMemo(
    () => normalizeRecentFolderEntries(recentFoldersEntries),
    [recentFoldersEntries],
  );
  const visibleRecentFolders = useMemo(() => fuzzyFilterEntries(
    normalizedRecentFolders,
    pathSearchQuery,
    (entry) => entry.searchText,
  ), [normalizedRecentFolders, pathSearchQuery]);
  const pathLookupContext = useMemo(
    () => parsePathLookupContext(pathSearchQuery),
    [parsePathLookupContext, pathSearchQuery],
  );
  const visiblePathFolderSuggestions = useMemo(() => {
    if (!pathLookupContext?.parentPath) return [];
    const folderPaths = folderSuggestionsByParentPath[pathLookupContext.parentPath];
    if (!Array.isArray(folderPaths) || folderPaths.length === 0) return [];

    const normalizedEntries = folderPaths.map((path) => ({
      path,
      openedAtMs: 0,
      isWorkspace: workspaceFolderPathSet.has(path),
      searchText: `${getPathLeafName(path)} ${path}`.trim().toLowerCase(),
    }));
    if (!pathLookupContext.childQuery) return normalizedEntries;
    return fuzzyFilterEntries(
      normalizedEntries,
      pathLookupContext.childQuery,
      (entry) => entry.searchText,
    );
  }, [
    folderSuggestionsByParentPath,
    getPathLeafName,
    pathLookupContext,
    workspaceFolderPathSet,
  ]);
  const visibleSuggestions = useMemo(() => {
    const mergedSuggestions = [...visiblePathFolderSuggestions];
    visibleRecentFolders.forEach((recentEntry) => {
      if (mergedSuggestions.some((entry) => isSamePath(entry.path, recentEntry.path))) return;
      mergedSuggestions.push(recentEntry);
    });
    return mergedSuggestions;
  }, [visiblePathFolderSuggestions, visibleRecentFolders]);

  useEffect(() => {
    if (!isPathEditing) return;
    pathInputRef.current?.focus();
    pathInputRef.current?.select();
  }, [isPathEditing]);

  useEffect(() => {
    if (!Number.isFinite(focusPathInputRequestKey) || focusPathInputRequestKey <= 0) return;
    if (focusPathInputRequestKey === lastFocusRequestKeyRef.current) return;
    lastFocusRequestKeyRef.current = focusPathInputRequestKey;

    if (isPathEditing) {
      pathInputRef.current?.focus();
      pathInputRef.current?.select();
      return;
    }

    setPathDraft(currentPath ?? "");
    setPathSearchQuery("");
    setSelectedSuggestionIndex(-1);
    setIsPathEditing(true);
  }, [currentPath, focusPathInputRequestKey, isPathEditing]);

  useEffect(() => {
    if (!isPathEditing) return;
    if (!pathLookupContext?.parentPath) return;
    if (typeof loadSubfoldersForPath !== "function") return;
    if (hasPathLookupResult(folderSuggestionsByParentPath, pathLookupContext.parentPath)) return;

    const requestId = folderSuggestionRequestIdRef.current + 1;
    folderSuggestionRequestIdRef.current = requestId;
    Promise.resolve(loadSubfoldersForPath(pathLookupContext.parentPath))
      .then((folderPaths) => {
        if (folderSuggestionRequestIdRef.current !== requestId) return;
        const normalizedFolderPaths = normalizeFolderSuggestionPaths(folderPaths);
        setFolderSuggestionsByParentPath((previous) => {
          if (hasPathLookupResult(previous, pathLookupContext.parentPath)) return previous;
          return {
            ...previous,
            [pathLookupContext.parentPath]: normalizedFolderPaths,
          };
        });
      })
      .catch(() => {
        if (folderSuggestionRequestIdRef.current !== requestId) return;
        setFolderSuggestionsByParentPath((previous) => {
          if (hasPathLookupResult(previous, pathLookupContext.parentPath)) return previous;
          return {
            ...previous,
            [pathLookupContext.parentPath]: [],
          };
        });
      });
  }, [
    folderSuggestionsByParentPath,
    hasPathLookupResult,
    isPathEditing,
    loadSubfoldersForPath,
    normalizeFolderSuggestionPaths,
    pathLookupContext,
  ]);

  useEffect(() => {
    if (!isPathEditing) return;
    setSelectedSuggestionIndex((current) => {
      if (visibleSuggestions.length === 0) return -1;
      if (current < 0) return -1;
      return Math.min(current, visibleSuggestions.length - 1);
    });
  }, [isPathEditing, visibleSuggestions.length]);

  const handleStartPathEditing = useCallback((event) => {
    event.stopPropagation();
    if (isPathEditing) return;
    if (event.type === "keydown") {
      if (event.key !== "Enter") return;
    } else {
      if (event.button !== 0) return;
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("button")) return;
    }
    setPathDraft(currentPath ?? "");
    setPathSearchQuery("");
    setIsPathEditing(true);
    setSelectedSuggestionIndex(-1);
  }, [currentPath, isPathEditing]);

  const handleSubmitPath = useCallback((event) => {
    event.preventDefault();
    const nextPath = pathDraft.trim();
    const firstSuggestedPath = visibleSuggestions[0]?.path ?? "";
    const shouldIncludeFallback = (
      typeof firstSuggestedPath === "string"
      && firstSuggestedPath.trim().length > 0
      && !arePathsEquivalent(firstSuggestedPath, nextPath)
    );
    setIsPathEditing(false);
    setIsPathInputFocused(false);
    setSelectedSuggestionIndex(-1);
    setPathSearchQuery("");
    if (!nextPath || nextPath === currentPath) return;
    if (shouldIncludeFallback) {
      onPathSubmit?.(nextPath, { fallbackPath: firstSuggestedPath });
      return;
    }
    onPathSubmit?.(nextPath);
  }, [arePathsEquivalent, currentPath, onPathSubmit, pathDraft, visibleSuggestions]);
  const handlePathInputBlur = useCallback(() => {
    const normalizedDraft = pathDraft.trim();
    const normalizedCurrentPath = (currentPath ?? "").trim();
    setIsPathInputFocused(false);
    setSelectedSuggestionIndex(-1);
    if (normalizedDraft === normalizedCurrentPath) {
      setIsPathEditing(false);
    }
  }, [currentPath, pathDraft]);

  const handlePathInputKeyDown = useCallback((event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setIsPathEditing(false);
      setIsPathInputFocused(false);
      setSelectedSuggestionIndex(-1);
      setPathDraft(currentPath ?? "");
      setPathSearchQuery("");
      return;
    }

    const suggestionCount = visibleSuggestions.length;
    if (suggestionCount === 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      let nextIndex;
      if (event.key === "ArrowDown") {
        nextIndex = selectedSuggestionIndex < 0 ? 0 : (selectedSuggestionIndex + 1) % suggestionCount;
      } else {
        nextIndex = selectedSuggestionIndex < 0
          ? suggestionCount - 1
          : (selectedSuggestionIndex - 1 + suggestionCount) % suggestionCount;
      }
      setSelectedSuggestionIndex(nextIndex);
      setPathDraft(visibleSuggestions[nextIndex]?.path ?? pathDraft);
    }
  }, [currentPath, pathDraft, selectedSuggestionIndex, visibleSuggestions]);
  const shouldShowSuggestions = isPathEditing && isPathInputFocused;
  const handleSuggestionMouseEnter = useCallback((index) => {
    if (index < 0 || index >= visibleSuggestions.length) return;
    setSelectedSuggestionIndex(index);
  }, [visibleSuggestions.length]);
  const handleSuggestionClick = useCallback((path) => {
    const normalizedPath = typeof path === "string" ? path.trim() : "";
    setPathDraft(normalizedPath);
    setSelectedSuggestionIndex(-1);
    setIsPathEditing(false);
    setIsPathInputFocused(false);
    setPathSearchQuery("");
    if (!normalizedPath) return;
    onSelectRecentFolder?.(normalizedPath);
  }, [onSelectRecentFolder]);

  return <div className={styles.breadcrumbStack}>
    <div
      className={styles.breadcrumbRow}
      role={isPathEditing ? undefined : "button"}
      tabIndex={isPathEditing ? undefined : 0}
      aria-label={isPathEditing ? undefined : "Edit current path"}
      onClick={handleStartPathEditing}
      onKeyDown={isPathEditing ? undefined : handleStartPathEditing}
    >
      {isPathEditing ? <form className={styles.pathForm} onSubmit={handleSubmitPath}>
        <input
          ref={pathInputRef}
          className={styles.pathInput}
          value={pathDraft}
          onChange={(event) => {
            setPathDraft(event.target.value);
            setPathSearchQuery(event.target.value);
            setSelectedSuggestionIndex(-1);
          }}
          onKeyDown={handlePathInputKeyDown}
          onFocus={() => setIsPathInputFocused(true)}
          onBlur={handlePathInputBlur}
          onMouseDown={event => event.stopPropagation()}
          aria-label="Current folder path"
        />
      </form> : <nav className={styles.breadcrumbs} aria-label="Current path">
        {crumbs.map((crumb, index) =>
          hasDropTargets ? <DroppableCrumbButton
            key={`${crumb.path}-${index}`}
            crumb={crumb}
            index={index}
            onSelect={onSelect}
            isMovingEntry={isMovingEntry}
            activeDragPaths={activeDragPaths}
            dropId={getDropIdForPath(crumb.path)}
            isWorkspaceFolder={workspaceFolderPathSet.has(crumb.path)}
          /> : <StaticCrumbButton
            key={`${crumb.path}-${index}`}
            crumb={crumb}
            onSelect={onSelect}
            isWorkspaceFolder={workspaceFolderPathSet.has(crumb.path)}
          />
        )}
      </nav>}
    </div>

    {shouldShowSuggestions ? <ul className={styles.recentFolderList}>
      {visibleSuggestions.map((entry, index) => <li key={entry.path} className={styles.recentFolderItem}>
        <button
          type="button"
          className={`${styles.recentFolderButton} ${selectedSuggestionIndex === index ? styles.recentFolderButtonSelected : ""}`.trim()}
          onMouseDown={event => event.preventDefault()}
          onMouseEnter={() => handleSuggestionMouseEnter(index)}
          onClick={() => handleSuggestionClick(entry.path)}
        >
          <span
            className={`${styles.recentFolderPath} ${entry.isWorkspace ? styles.recentFolderPathWorkspace : ""}`.trim()}
          >
            {entry.path}
          </span>
          <span className={styles.recentFolderDate}>
            {formatRecentFolderOpenedAtLabel(entry.openedAtMs)}
          </span>
        </button>
      </li>)}
      {visibleSuggestions.length === 0 && !isLoadingRecentFolders ? <li className={styles.recentFolderEmpty}>
        No recent folders.
      </li> : null}
      {isLoadingRecentFolders ? <li className={styles.recentFolderEmpty}>
        Loading recent folders...
      </li> : null}
    </ul> : null}
  </div>;
}

export default Breadcrumbs;
