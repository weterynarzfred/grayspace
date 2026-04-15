import { describe, expect, it } from "vitest";
import { getPaneDropZoneId, parsePaneDropZoneId } from "./panelDropZoneIds";

describe("panelDropZoneIds", () => {
  it("formats and parses pane drop zone ids", () => {
    const zoneId = getPaneDropZoneId("tab-1", "pane-a", "left");
    expect(zoneId).toBe("pane-drop-zone:tab-1:pane-a:left");
    expect(parsePaneDropZoneId(zoneId)).toEqual({
      tabId: "tab-1",
      paneId: "pane-a",
      zone: "left",
    });
  });

  it("returns empty metadata for unsupported ids", () => {
    expect(parsePaneDropZoneId("preview-drop:pane-a")).toEqual({
      tabId: "",
      paneId: "",
      zone: "",
    });
  });
});
