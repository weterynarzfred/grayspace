import { useDroppable } from "@dnd-kit/core";
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
  activeDragPaths = [],
  isMovingEntry = false,
  getDropIdForPath,
  workspaceFolderPathSet = new Set(),
}) {
  const crumbs = buildBreadcrumbs(currentPath, currentDrive);
  const hasDropTargets = typeof getDropIdForPath === "function";

  return <nav className={styles.breadcrumbs} aria-label="Current path">
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
  </nav>;
}

export default Breadcrumbs;
