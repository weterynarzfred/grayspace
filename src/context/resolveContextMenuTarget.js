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

  const boundary = contextNode.getAttribute("data-contextmenu-boundary") || "";
  const allowedKinds = ALLOWED_KINDS_BY_BOUNDARY[boundary];
  if (!allowedKinds) return null;

  const kind = contextNode.getAttribute("data-context-kind") || "";
  if (!allowedKinds.has(kind)) return null;

  return {
    kind,
    id: contextNode.getAttribute("data-context-id") || "",
    label: contextNode.getAttribute("data-context-label") || "",
    path: contextNode.getAttribute("data-context-path") || "",
    scope: contextNode.getAttribute("data-context-scope") || "",
    paneId: contextNode.getAttribute("data-context-pane-id") || "",
    panelType: contextNode.getAttribute("data-context-panel-type") || "",
  };
}
