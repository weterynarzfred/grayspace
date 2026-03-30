import { resolveFilesystemIconClass } from "./fileIconResolver";

describe("resolveFilesystemIconClass", () => {
  it("returns a folder fallback icon for directories", () => {
    expect(resolveFilesystemIconClass("src", { isDirectory: true }))
      .toBe("config-icon medium-yellow");
  });

  it("returns a mapped icon class for files", () => {
    const iconClass = resolveFilesystemIconClass("main.rs");
    expect(iconClass).toMatch(/\b[a-z0-9_-]+-icon\b/i);
  });

  it("returns a file fallback icon when name is empty", () => {
    expect(resolveFilesystemIconClass("")).toBe("text-icon medium-blue");
  });
});

