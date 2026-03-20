import {
  getSelectedPathsFromState,
  uniqueNonEmptyPaths,
} from "./pathSelection";

describe("pathSelection", () => {
  it("removes empty values and duplicates while preserving order", () => {
    expect(uniqueNonEmptyPaths([
      "C:\\Users",
      "",
      null,
      "C:\\notes.txt",
      "C:\\Users",
      undefined,
      "C:\\draft.md",
    ])).toEqual([
      "C:\\Users",
      "C:\\notes.txt",
      "C:\\draft.md",
    ]);
  });

  it("builds state selection from selectedPaths with selectedPath fallback", () => {
    expect(getSelectedPathsFromState({
      selectedPaths: ["C:\\Users\\todo.txt"],
      selectedPath: "C:\\Users\\Projects",
    })).toEqual([
      "C:\\Users\\todo.txt",
      "C:\\Users\\Projects",
    ]);
  });

  it("supports legacy selectedPath-only state", () => {
    expect(getSelectedPathsFromState({
      selectedPath: "C:\\Users\\todo.txt",
    })).toEqual(["C:\\Users\\todo.txt"]);
  });
});
