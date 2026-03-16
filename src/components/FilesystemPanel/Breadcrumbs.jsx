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

function Breadcrumbs({ currentPath, currentDrive, onSelect }) {
  const crumbs = buildBreadcrumbs(currentPath, currentDrive);

  return (
    <nav className={styles.breadcrumbs} aria-label="Current path">
      {crumbs.map((crumb, index) => (
        <button
          key={`${crumb.path}-${index}`}
          type="button"
          className={styles.crumbButton}
          onClick={() => onSelect(crumb.path)}
        >
          {index > 0 && <span className={styles.crumbSeparator}>/</span>}
          <span>{crumb.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default Breadcrumbs;
