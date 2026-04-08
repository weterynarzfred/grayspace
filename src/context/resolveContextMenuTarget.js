const ALLOWED_KINDS_BY_BOUNDARY = {
  "filesystem-entry": new Set(["file", "folder"]),
  breadcrumb: new Set(["breadcrumb"]),
  tab: new Set(["tab"]),
  panel: new Set(["panel"]),
};

export default function resolveContextMenuTarget(target) {
  if (!(target instanceof Element)) return null;
  const contextNode = target.closest("[data-contextmenu-boundary]");
  if (!contextNode) return null;

  const boundary = contextNode.dataset.contextmenuBoundary || "";
  const allowedKinds = ALLOWED_KINDS_BY_BOUNDARY[boundary];
  if (!allowedKinds) return null;

  const kind = contextNode.dataset.contextKind || "";
  if (!allowedKinds.has(kind)) return null;

  return {
    kind,
    id: contextNode.dataset.contextId || "",
    label: contextNode.dataset.contextLabel || "",
    path: contextNode.dataset.contextPath || "",
    scope: contextNode.dataset.contextScope || "",
    paneId: contextNode.dataset.contextPaneId || "",
    panelType: contextNode.dataset.contextPanelType || "",
  };
}
