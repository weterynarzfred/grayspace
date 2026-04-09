import { fuzzyFilterEntries } from "./fuzzySearch";

describe("fuzzyFilterEntries", () => {
  it("returns original entries when query is blank", () => {
    const entries = ["Open Tab", "Close Tab"];
    expect(fuzzyFilterEntries(entries, "   ")).toEqual(entries);
  });

  it("matches using fuzzy ranking for object entries", () => {
    const entries = [
      { id: "tab.new", text: "New Tab" },
      { id: "window.new", text: "New Window" },
      { id: "tab.close", text: "Close Tab" },
    ];

    const results = fuzzyFilterEntries(entries, "n tab", (entry) => entry.text);
    expect(results.map((entry) => entry.id)).toContain("tab.new");
    expect(results.map((entry) => entry.id)).not.toContain("tab.close");
  });

  it("falls back to substring matching for symbol-only queries", () => {
    const entries = ["C:\\Users", "D:\\Archive", "/tmp/work"];
    expect(fuzzyFilterEntries(entries, "\\")).toEqual(["C:\\Users", "D:\\Archive"]);
    expect(fuzzyFilterEntries(entries, "/")).toEqual(["/tmp/work"]);
  });
});

