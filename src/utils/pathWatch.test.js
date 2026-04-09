import {
  getParentDirectoryPath,
  isSamePath,
  normalizePathForComparison,
} from "./pathWatch";

describe("pathWatch", () => {
  it("normalizes windows paths and device-prefixed paths for comparisons", () => {
    expect(normalizePathForComparison("  C:\\Users\\Alice\\ ")).toBe("c:/users/alice");
    expect(normalizePathForComparison("\\\\?\\C:\\Users\\Alice\\")).toBe("c:/users/alice");
    expect(normalizePathForComparison("\\\\?\\UNC\\Server\\Share\\Folder\\")).toBe("//server/share/folder");
    expect(normalizePathForComparison("\\\\.\\C:\\Temp\\Logs\\")).toBe("c:/temp/logs");
  });

  it("returns empty normalized paths for non-strings and blank strings", () => {
    expect(normalizePathForComparison("")).toBe("");
    expect(normalizePathForComparison("   ")).toBe("");
    expect(normalizePathForComparison(null)).toBe("");
    expect(normalizePathForComparison(undefined)).toBe("");
  });

  it("compares paths by normalized value and rejects empty inputs", () => {
    expect(isSamePath("C:\\Users\\Alice\\notes.txt", "c:/users/alice/notes.txt/")).toBe(true);
    expect(isSamePath("\\\\?\\C:\\Users\\Alice", "c:/users/alice")).toBe(true);
    expect(isSamePath("", "c:/users/alice")).toBe(false);
    expect(isSamePath("c:/users/alice", "")).toBe(false);
    expect(isSamePath("c:/users/alice", "c:/users/bob")).toBe(false);
  });

  it("computes parent directories across file, drive, and mixed separator paths", () => {
    expect(getParentDirectoryPath("C:\\Users\\Alice\\notes.txt")).toBe("C:\\Users\\Alice");
    expect(getParentDirectoryPath("C:/Users/Alice/notes.txt")).toBe("C:/Users/Alice");
    expect(getParentDirectoryPath("C:\\Users\\")).toBe("C:\\");
    expect(getParentDirectoryPath("folder/subfolder")).toBe("folder");
    expect(getParentDirectoryPath("no-separator")).toBe("");
    expect(getParentDirectoryPath(42)).toBe("");
  });
});
