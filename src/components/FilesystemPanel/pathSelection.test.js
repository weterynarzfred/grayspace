import {
  getSelectedPathsFromState,
  uniqueNonEmptyPaths,
} from "../../utils/pathSelection";

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

  it("builds state selection from selectedPaths", () => {
    expect(getSelectedPathsFromState({
      selectedPaths: ["C:\\Users\\todo.txt"],
    })).toEqual([
      "C:\\Users\\todo.txt",
    ]);
  });

  it("returns an empty array for invalid state", () => {
    expect(getSelectedPathsFromState({
      selectedPaths: null,
    })).toEqual([]);
  });
});
