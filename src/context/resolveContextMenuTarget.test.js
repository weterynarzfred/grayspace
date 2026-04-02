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
      "data-context-kind": "tab",
      "data-context-id": "tab-1",
      "data-context-label": "Workspace",
    });

    expect(resolveContextMenuTarget(target)).toEqual({
      kind: "tab",
      id: "tab-1",
      label: "Workspace",
      path: "",
    });
  });

  it("returns null for unsupported context kinds", () => {
    const target = createTarget({
      "data-context-kind": "notification",
      "data-context-id": "n-1",
    });

    expect(resolveContextMenuTarget(target)).toBeNull();
  });
});
