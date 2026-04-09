import { useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatRecentFolderOpenedAtLabel,
  normalizeRecentFolderEntries,
} from "../popovers/recentFoldersShared";
import { fuzzyFilterEntries } from "../popovers/fuzzySearch";
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
}) {
  const arePathsEquivalent = useCallback((leftPath, rightPath) => {
    const normalizedLeft = typeof leftPath === "string" ? leftPath.trim().toLowerCase() : "";
    const normalizedRight = typeof rightPath === "string" ? rightPath.trim().toLowerCase() : "";
    return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
  }, []);
  const [isPathEditing, setIsPathEditing] = useState(false);
  const [isPathInputFocused, setIsPathInputFocused] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  const [pathSearchQuery, setPathSearchQuery] = useState("");
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
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

  useEffect(() => {
    if (!isPathEditing) return;
    pathInputRef.current?.focus();
    pathInputRef.current?.select();
  }, [isPathEditing]);

  useEffect(() => {
    if (!isPathEditing) return;
    setSelectedSuggestionIndex((current) => {
      if (visibleRecentFolders.length === 0) return -1;
      if (current < 0) return -1;
      return Math.min(current, visibleRecentFolders.length - 1);
    });
  }, [isPathEditing, visibleRecentFolders.length]);

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
    const firstSuggestedPath = visibleRecentFolders[0]?.path ?? "";
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
  }, [arePathsEquivalent, currentPath, onPathSubmit, pathDraft, visibleRecentFolders]);
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

    const suggestionCount = visibleRecentFolders.length;
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
      setPathDraft(visibleRecentFolders[nextIndex]?.path ?? pathDraft);
    }
  }, [currentPath, pathDraft, selectedSuggestionIndex, visibleRecentFolders]);
  const shouldShowSuggestions = isPathEditing && isPathInputFocused;
  const handleSuggestionMouseEnter = useCallback((index) => {
    if (index < 0 || index >= visibleRecentFolders.length) return;
    setSelectedSuggestionIndex(index);
  }, [visibleRecentFolders.length]);
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
      {visibleRecentFolders.map((entry, index) => <li key={entry.path} className={styles.recentFolderItem}>
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
      {visibleRecentFolders.length === 0 && !isLoadingRecentFolders ? <li className={styles.recentFolderEmpty}>
        No recent folders.
      </li> : null}
      {isLoadingRecentFolders ? <li className={styles.recentFolderEmpty}>
        Loading recent folders...
      </li> : null}
    </ul> : null}
  </div>;
}

export default Breadcrumbs;
