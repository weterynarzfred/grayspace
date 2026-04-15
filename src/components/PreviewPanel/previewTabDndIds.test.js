import { describe, expect, it } from "vitest";
import {
  getPreviewTabBarDropId,
  getPreviewTabDragId,
  getPreviewTabDropId,
  parsePreviewTabDropId,
} from "./previewTabDndIds";

describe("previewTabDndIds", () => {
  it("formats drag and tab drop ids", () => {
    expect(getPreviewTabDragId("pane-a", "C:\\notes.txt"))
      .toBe("preview-tab-drag:pane-a:C:\\notes.txt");
    expect(getPreviewTabDropId("pane-a", "C:\\notes.txt", "left"))
      .toBe("preview-tab-drop:pane-a:left:C:\\notes.txt");
  });

  it("parses tab and bar drop ids", () => {
    expect(parsePreviewTabDropId("preview-tab-drop:pane-a:right:C:\\notes.txt"))
      .toEqual({
        kind: "tab",
        paneId: "pane-a",
        path: "C:\\notes.txt",
        side: "right",
      });

    const barDropId = getPreviewTabBarDropId("pane-b");
    expect(parsePreviewTabDropId(barDropId))
      .toEqual({
        kind: "bar",
        paneId: "pane-b",
        path: "",
        side: "right",
      });
  });
});
