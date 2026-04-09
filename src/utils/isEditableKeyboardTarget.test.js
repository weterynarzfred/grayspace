import isEditableKeyboardTarget from "./isEditableKeyboardTarget";

describe("isEditableKeyboardTarget", () => {
  it("returns false for nullish and non-element targets", () => {
    expect(isEditableKeyboardTarget(null)).toBe(false);
    expect(isEditableKeyboardTarget(undefined)).toBe(false);
    expect(isEditableKeyboardTarget({ tagName: "INPUT" })).toBe(false);
  });

  it("returns true for input-like form controls", () => {
    expect(isEditableKeyboardTarget(document.createElement("input"))).toBe(true);
    expect(isEditableKeyboardTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableKeyboardTarget(document.createElement("select"))).toBe(true);
  });

  it("returns true for contenteditable elements", () => {
    const editableDiv = document.createElement("div");
    Object.defineProperty(editableDiv, "isContentEditable", {
      value: true,
      configurable: true,
    });

    expect(isEditableKeyboardTarget(editableDiv)).toBe(true);
  });

  it("returns false for non-editable elements", () => {
    expect(isEditableKeyboardTarget(document.createElement("div"))).toBe(false);
    expect(isEditableKeyboardTarget(document.createElement("button"))).toBe(false);
  });
});
