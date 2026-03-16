import { useDroppable } from "@dnd-kit/core";
import styles from "./Breadcrumbs.module.scss";

export function buildBreadcrumbs(currentPath, currentDrive) {
  if (!currentPath || !currentDrive) {
    return [];
  }

  const separator = currentDrive.includes("\\") ? "\\" : "/";
  const driveRoot = currentDrive.replace(/[\\/]+$/, "");
  const normalizedCurrentPath = currentPath.replace(/[\\/]+$/, "");

  const crumbs = [
    { label: "Drives", path: "" },
    { label: currentDrive, path: currentDrive },
  ];
  const remainder = normalizedCurrentPath.slice(driveRoot.length).replace(/^[\\/]+/, "");

  if (!remainder) {
    return crumbs;
  }

  let runningPath = driveRoot;
  const parts = remainder.split(/[\\/]+/).filter(Boolean);

  for (const part of parts) {
    runningPath = `${runningPath}${separator}${part}`;
    crumbs.push({ label: part, path: runningPath });
  }

  return crumbs;
}

function StaticCrumbButton({ crumb, index, onSelect }) {
  return (
    <button
      type="button"
      className={styles.crumbButton}
      onClick={() => onSelect(crumb.path)}
    >
      {index > 0 && <span className={styles.crumbSeparator}>/</span>}
      <span>{crumb.label}</span>
    </button>
  );
}

function DroppableCrumbButton({
  crumb,
  index,
  onSelect,
  isMovingEntry,
  activeDragPath,
  dropId,
}) {
  const hasDestinationPath = Boolean(crumb.path);
  const { isOver, setNodeRef } = useDroppable({
    id: dropId || `breadcrumb-disabled-${index}`,
    disabled: !hasDestinationPath || isMovingEntry,
  });
  const isDropTarget =
    hasDestinationPath &&
    isOver &&
    Boolean(activeDragPath) &&
    activeDragPath !== crumb.path;

  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`${styles.crumbButton} ${isDropTarget ? styles.dropTarget : ""}`}
      onClick={() => onSelect(crumb.path)}
    >
      {index > 0 && <span className={styles.crumbSeparator}>/</span>}
      <span>{crumb.label}</span>
    </button>
  );
}

function Breadcrumbs({
  currentPath,
  currentDrive,
  onSelect,
  activeDragPath = "",
  isMovingEntry = false,
  getDropIdForPath,
}) {
  const crumbs = buildBreadcrumbs(currentPath, currentDrive);
  const hasDropTargets = typeof getDropIdForPath === "function";

  return (
    <nav className={styles.breadcrumbs} aria-label="Current path">
      {crumbs.map((crumb, index) => (
        hasDropTargets ? (
          <DroppableCrumbButton
            key={`${crumb.path}-${index}`}
            crumb={crumb}
            index={index}
            onSelect={onSelect}
            isMovingEntry={isMovingEntry}
            activeDragPath={activeDragPath}
            dropId={getDropIdForPath(crumb.path)}
          />
        ) : (
          <StaticCrumbButton
            key={`${crumb.path}-${index}`}
            crumb={crumb}
            index={index}
            onSelect={onSelect}
          />
        )
      ))}
    </nav>
  );
}

export default Breadcrumbs;
