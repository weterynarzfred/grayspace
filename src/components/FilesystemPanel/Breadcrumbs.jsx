import { useDroppable } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatRecentFolderOpenedAtLabel,
  normalizeRecentFolderEntries,
} from "../popovers/recentFoldersShared";
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
  const [isPathEditing, setIsPathEditing] = useState(false);
  const [isPathInputFocused, setIsPathInputFocused] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const pathInputRef = useRef(null);
  const crumbs = buildBreadcrumbs(currentPath, currentDrive);
  const hasDropTargets = typeof getDropIdForPath === "function";
  const normalizedRecentFolders = useMemo(
    () => normalizeRecentFolderEntries(recentFoldersEntries),
    [recentFoldersEntries],
  );

  useEffect(() => {
    if (!isPathEditing) return;
    pathInputRef.current?.focus();
    pathInputRef.current?.select();
  }, [isPathEditing]);

  const handleStartPathEditing = useCallback((event) => {
    event.stopPropagation();
    if (isPathEditing) return;
    if (event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("button")) return;
    setPathDraft(currentPath ?? "");
    setIsPathEditing(true);
    setSelectedSuggestionIndex(-1);
  }, [currentPath, isPathEditing]);

  const handleSubmitPath = useCallback((event) => {
    event.preventDefault();
    const nextPath = pathDraft.trim();
    setIsPathEditing(false);
    setIsPathInputFocused(false);
    setSelectedSuggestionIndex(-1);
    if (!nextPath || nextPath === currentPath) return;
    onPathSubmit?.(nextPath);
  }, [currentPath, onPathSubmit, pathDraft]);
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
      return;
    }

    const suggestionCount = normalizedRecentFolders.length;
    if (suggestionCount === 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = event.key === "ArrowDown"
        ? (selectedSuggestionIndex < 0 ? 0 : (selectedSuggestionIndex + 1) % suggestionCount)
        : (selectedSuggestionIndex < 0
          ? suggestionCount - 1
          : (selectedSuggestionIndex - 1 + suggestionCount) % suggestionCount);
      setSelectedSuggestionIndex(nextIndex);
      setPathDraft(normalizedRecentFolders[nextIndex]?.path ?? pathDraft);
    }
  }, [currentPath, normalizedRecentFolders, pathDraft, selectedSuggestionIndex]);
  const shouldShowSuggestions = isPathEditing && isPathInputFocused;
  const handleSuggestionMouseEnter = useCallback((index) => {
    if (index < 0 || index >= normalizedRecentFolders.length) return;
    setSelectedSuggestionIndex(index);
  }, [normalizedRecentFolders.length]);
  const handleSuggestionClick = useCallback((path) => {
    const normalizedPath = typeof path === "string" ? path.trim() : "";
    setPathDraft(normalizedPath);
    setSelectedSuggestionIndex(-1);
    setIsPathEditing(false);
    setIsPathInputFocused(false);
    if (!normalizedPath) return;
    onSelectRecentFolder?.(normalizedPath);
  }, [onSelectRecentFolder]);

  return <div className={styles.breadcrumbStack}>
    <div
      className={styles.breadcrumbRow}
      onClick={handleStartPathEditing}
    >
      {isPathEditing ? <form className={styles.pathForm} onSubmit={handleSubmitPath}>
        <input
          ref={pathInputRef}
          className={styles.pathInput}
          value={pathDraft}
          onChange={(event) => {
            setPathDraft(event.target.value);
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
      {normalizedRecentFolders.map((entry, index) => <li key={entry.path} className={styles.recentFolderItem}>
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
      {normalizedRecentFolders.length === 0 && !isLoadingRecentFolders ? <li className={styles.recentFolderEmpty}>
        No recent folders.
      </li> : null}
      {isLoadingRecentFolders ? <li className={styles.recentFolderEmpty}>
        Loading recent folders...
      </li> : null}
    </ul> : null}
  </div>;
}

export default Breadcrumbs;
