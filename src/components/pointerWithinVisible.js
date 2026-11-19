import { pointerWithin } from "@dnd-kit/core";

// pointerWithin, without the droppables in a filesystem pane's scroll body that are scrolled out of
// it. dnd-kit measures droppables wherever they are, and a pane renders rows out of view (a windowed
// list a few past each edge), so over the pane's header or a pane below, a folder no one can see
// would take the drop. Droppables outside a scroll body, the pane's own among them, are kept.
export default function pointerWithinVisible(args) {
  return pointerWithin(args).filter(({ data }) => {
    // A row the window unmounted mid-drag has no node until dnd-kit unregisters it (in an effect).
    const node = data.droppableContainer.node.current;
    if (!node) return false;
    const scrollBody = node.closest("[data-panel-scroll]");
    if (!scrollBody) return true;
    const { left, right, top, bottom } = scrollBody.getBoundingClientRect();
    const { x, y } = args.pointerCoordinates;
    return left <= x && x <= right && top <= y && y <= bottom;
  });
}
