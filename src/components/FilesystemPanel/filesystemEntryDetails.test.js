import { describeEntryType, formatEntrySize, getEntryDetails } from "./filesystemEntryDetails";

describe("filesystemEntryDetails", () => {
  it("formats sizes with binary units", () => {
    expect(formatEntrySize(0)).toBe("0 B");
    expect(formatEntrySize(1023)).toBe("1023 B");
    expect(formatEntrySize(1536)).toBe("1.5 KB");
    expect(formatEntrySize(50 * 1024 * 1024)).toBe("50 MB");
    expect(formatEntrySize(undefined)).toBe("");
  });

  it("describes entry types from the extension", () => {
    expect(describeEntryType("photo.jpeg", false)).toBe("JPEG file");
    expect(describeEntryType("archive.tar.gz", false)).toBe("GZ file");
    expect(describeEntryType(".gitignore", false)).toBe("File");
    expect(describeEntryType("Makefile", false)).toBe("File");
    expect(describeEntryType("photos.2024", true)).toBe("Folder");
  });

  it("leaves size blank for folders and missing metadata", () => {
    expect(getEntryDetails({ name: "docs", is_dir: true, size_bytes: null, modified_ms: null })).toEqual({
      modified: "",
      type: "Folder",
      size: "",
    });
    expect(getEntryDetails({ name: "a.txt", is_dir: false, size_bytes: 5, modified_ms: 0 })).toMatchObject({
      type: "TXT file",
      size: "5 B",
    });
  });
});
