const CONTEXT_MENU_KINDS = new Set(["file", "folder", "breadcrumb", "tab"]);

export default function resolveContextMenuTarget(target) {
  if (!(target instanceof Element)) return null;
  const contextNode = target.closest("[data-context-kind]");
  if (!contextNode) return null;

  const kind = contextNode.getAttribute("data-context-kind") || "";
  if (!CONTEXT_MENU_KINDS.has(kind)) return null;

  return {
    kind,
    id: contextNode.getAttribute("data-context-id") || "",
    label: contextNode.getAttribute("data-context-label") || "",
    path: contextNode.getAttribute("data-context-path") || "",
  };
}
