import { getPanelSelectedFilesLabel } from "./selectedFilesLabel";

describe("getPanelSelectedFilesLabel", () => {
  it("returns the base label when there is no selection", () => {
    expect(getPanelSelectedFilesLabel("Preview panel", {})).toBe("Preview panel");
  });

  it("shows the selected filename for a single selected path", () => {
    expect(getPanelSelectedFilesLabel("Preview panel", {
      selectedPaths: ["C:\\Users\\todo.txt"],
    })).toBe("Preview panel: todo.txt");
  });

  it("shows item count for multiple selected paths", () => {
    expect(getPanelSelectedFilesLabel("Preview panel", {
      selectedPaths: [
        "C:\\Users\\todo.txt",
        "C:\\Users\\draft.md",
      ],
    })).toBe("Preview panel: 2");
  });
});
