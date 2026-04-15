import { describe, expect, it } from "vitest";
import {
  closePreviewTab,
  createEmptyPreviewPaneState,
  getPreviewTabsByPaths,
  insertPreviewTabs,
  openPathInPreviewPaneState,
  removePreviewTabsByPaths,
  setActivePreviewTab,
  updatePreviewTab,
} from "./previewPaneState";

describe("previewPaneState", () => {
  it("opens first selected file as an ephemeral tab", () => {
    const nextState = openPathInPreviewPaneState(
      createEmptyPreviewPaneState(),
      "C:\\one.txt",
      { openAsEphemeral: true },
    );

    expect(nextState.activePath).toBe("C:\\one.txt");
    expect(nextState.tabs).toEqual([
      {
        path: "C:\\one.txt",
        isEphemeral: true,
        isDirty: false,
        draftContent: "",
      },
    ]);
  });

  it("replaces the previous ephemeral tab when a new file is selected", () => {
    const withFirst = openPathInPreviewPaneState(
      createEmptyPreviewPaneState(),
      "C:\\one.txt",
      { openAsEphemeral: true },
    );
    const withSecond = openPathInPreviewPaneState(withFirst, "C:\\two.txt", {
      openAsEphemeral: true,
    });

    expect(withSecond.activePath).toBe("C:\\two.txt");
    expect(withSecond.tabs).toHaveLength(1);
    expect(withSecond.tabs[0]?.path).toBe("C:\\two.txt");
    expect(withSecond.tabs[0]?.isEphemeral).toBe(true);
  });

  it("replaces ephemeral tab with a pinned tab when requested", () => {
    const withEphemeral = openPathInPreviewPaneState(
      createEmptyPreviewPaneState(),
      "C:\\one.txt",
      { openAsEphemeral: true },
    );
    const withPinned = openPathInPreviewPaneState(withEphemeral, "C:\\two.txt", {
      openAsEphemeral: false,
    });

    expect(withPinned.tabs).toEqual([
      {
        path: "C:\\two.txt",
        isEphemeral: false,
        isDirty: false,
        draftContent: "",
      },
    ]);
  });

  it("activates existing tab and removes ephemeral flag when opening pinned", () => {
    const withEphemeral = openPathInPreviewPaneState(
      createEmptyPreviewPaneState(),
      "C:\\one.txt",
      { openAsEphemeral: true },
    );
    const withPinned = openPathInPreviewPaneState(withEphemeral, "C:\\one.txt", {
      openAsEphemeral: false,
    });

    expect(withPinned.activePath).toBe("C:\\one.txt");
    expect(withPinned.tabs[0]?.isEphemeral).toBe(false);
  });

  it("updates dirty and draft state without changing active tab", () => {
    const withTab = openPathInPreviewPaneState(
      createEmptyPreviewPaneState(),
      "C:\\one.txt",
      { openAsEphemeral: false },
    );
    const updated = updatePreviewTab(withTab, "C:\\one.txt", {
      isDirty: true,
      draftContent: "changed",
    });

    expect(updated.activePath).toBe("C:\\one.txt");
    expect(updated.tabs[0]).toEqual({
      path: "C:\\one.txt",
      isEphemeral: false,
      isDirty: true,
      draftContent: "changed",
    });
  });

  it("closes active tab and activates a remaining neighbor", () => {
    const withFirst = openPathInPreviewPaneState(
      createEmptyPreviewPaneState(),
      "C:\\one.txt",
      { openAsEphemeral: false },
    );
    const withSecond = openPathInPreviewPaneState(withFirst, "C:\\two.txt", {
      openAsEphemeral: false,
    });
    const withFirstActive = setActivePreviewTab(withSecond, "C:\\one.txt");
    const afterClose = closePreviewTab(withFirstActive, "C:\\one.txt");

    expect(afterClose.tabs).toHaveLength(1);
    expect(afterClose.tabs[0]?.path).toBe("C:\\two.txt");
    expect(afterClose.activePath).toBe("C:\\two.txt");
  });

  it("extracts and reinserts tabs while preserving dirty state", () => {
    const base = openPathInPreviewPaneState(
      createEmptyPreviewPaneState(),
      "C:\\one.txt",
      { openAsEphemeral: false },
    );
    const withTwo = openPathInPreviewPaneState(base, "C:\\two.txt", {
      openAsEphemeral: false,
    });
    const withDirtyTwo = updatePreviewTab(withTwo, "C:\\two.txt", {
      isDirty: true,
      draftContent: "draft",
    });

    const extractedTabs = getPreviewTabsByPaths(withDirtyTwo, ["C:\\two.txt"]);
    expect(extractedTabs).toHaveLength(1);
    expect(extractedTabs[0]).toMatchObject({
      path: "C:\\two.txt",
      isDirty: true,
      draftContent: "draft",
    });

    const withoutTwo = removePreviewTabsByPaths(withDirtyTwo, ["C:\\two.txt"]);
    expect(withoutTwo.tabs.map(tab => tab.path)).toEqual(["C:\\one.txt"]);

    const reinserted = insertPreviewTabs(withoutTwo, extractedTabs, {
      targetPath: "C:\\one.txt",
      targetSide: "left",
      activePath: "C:\\two.txt",
    });
    expect(reinserted.tabs.map(tab => tab.path)).toEqual(["C:\\two.txt", "C:\\one.txt"]);
    expect(reinserted.activePath).toBe("C:\\two.txt");
    expect(reinserted.tabs[0]).toMatchObject({
      isDirty: true,
      draftContent: "draft",
    });
  });
});
