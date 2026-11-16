import { resolvePasteDestination } from "./useFilesystemClipboardCommands";

const entryByPath = {
  "C:\\work\\docs": { is_dir: true },
  "C:\\work\\notes.txt": { is_dir: false },
};

describe("resolvePasteDestination", () => {
  it("pastes into the right-clicked folder", () => {
    const context = {
      source: "context-menu",
      targetType: "folder",
      targetScope: "tree-entry",
      targetPath: "C:\\work\\other",
    };
    expect(resolvePasteDestination(context, ["C:\\work\\docs"], entryByPath, "C:\\work"))
      .toBe("C:\\work\\other");
  });

  it("prefers a selected folder, then the selected file's folder, then the current folder", () => {
    expect(resolvePasteDestination({}, ["C:\\work\\notes.txt", "C:\\work\\docs"], entryByPath, "C:\\work"))
      .toBe("C:\\work\\docs");
    expect(resolvePasteDestination({}, ["C:\\work\\notes.txt"], entryByPath, "C:\\elsewhere"))
      .toBe("C:\\work");
    expect(resolvePasteDestination({}, [], entryByPath, "C:\\work")).toBe("C:\\work");
  });
});
