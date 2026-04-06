import resolveContextMenuTarget from "./resolveContextMenuTarget";

function createTarget(attributes = {}) {
  const node = document.createElement("button");
  Object.entries(attributes).forEach(([key, value]) => {
    node.setAttribute(key, value);
  });
  return node;
}

describe("resolveContextMenuTarget", () => {
  it("extracts tab context target data", () => {
    const target = createTarget({
      "data-contextmenu-boundary": "tab",
      "data-context-kind": "tab",
      "data-context-id": "tab-1",
      "data-context-label": "Workspace",
    });

    expect(resolveContextMenuTarget(target)).toEqual({
      kind: "tab",
      id: "tab-1",
      label: "Workspace",
      path: "",
      scope: "",
      paneId: "",
      panelType: "",
    });
  });

  it("returns null for unsupported context boundaries", () => {
    const target = createTarget({
      "data-contextmenu-boundary": "notification",
      "data-context-kind": "notification",
    });

    expect(resolveContextMenuTarget(target)).toBeNull();
  });

  it("reads panel type for panel targets", () => {
    const target = createTarget({
      "data-contextmenu-boundary": "panel",
      "data-context-kind": "panel",
      "data-context-id": "pane-1",
      "data-context-label": "Filesystem",
      "data-context-panel-type": "Filesystem",
    });

    expect(resolveContextMenuTarget(target)).toEqual({
      kind: "panel",
      id: "pane-1",
      label: "Filesystem",
      path: "",
      scope: "",
      paneId: "",
      panelType: "Filesystem",
    });
  });
});
