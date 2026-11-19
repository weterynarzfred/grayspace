import pointerWithinVisible from "./pointerWithinVisible";

const toRect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

describe("pointerWithinVisible", () => {
  let droppableContainers;
  let droppableRects;

  // A pane with a 40 px header over a scroll body that shows y 100 to 500, and the pane below it.
  // The body renders a row in view and, as a list window does, rows scrolled past its edges.
  beforeEach(() => {
    document.body.innerHTML = `
      <section data-droppable-id="pane">
        <div data-panel-scroll="true">
          <div data-droppable-id="row-above"></div>
          <div data-droppable-id="shown-row"></div>
          <div data-droppable-id="row-below"></div>
        </div>
      </section>
      <section data-droppable-id="pane-below"></section>
    `;
    document.querySelector("[data-panel-scroll]").getBoundingClientRect = () => toRect(0, 100, 600, 400);
    droppableContainers = Array.from(document.querySelectorAll("[data-droppable-id]"), (node) => ({
      id: node.dataset.droppableId,
      node: { current: node },
    }));
    droppableRects = new Map([
      ["pane", toRect(0, 60, 600, 440)],
      ["row-above", toRect(0, 70, 600, 32)],
      ["shown-row", toRect(0, 140, 600, 32)],
      ["row-below", toRect(0, 520, 600, 32)],
      ["pane-below", toRect(0, 500, 600, 400)],
    ]);
  });

  const collide = (x, y) => pointerWithinVisible({ droppableContainers, droppableRects, pointerCoordinates: { x, y } })
    .map(({ id }) => id);

  it("leaves out rows scrolled out of a pane's scroll body, so its header and the pane below keep the drop", () => {
    expect(collide(300, 80)).toEqual(["pane"]);
    expect(collide(300, 530)).toEqual(["pane-below"]);
  });

  it("keeps a row in view, and the pane around it", () => {
    expect(collide(300, 150)).toEqual(["shown-row", "pane"]);
  });

  it("leaves out a row the window unmounted mid-drag", () => {
    droppableContainers.push({ id: "unmounted-row", node: { current: null } });
    droppableRects.set("unmounted-row", toRect(0, 552, 600, 32));
    expect(collide(300, 560)).toEqual(["pane-below"]);
  });
});
