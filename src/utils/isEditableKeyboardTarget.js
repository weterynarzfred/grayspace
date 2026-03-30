export default function isEditableKeyboardTarget(target) {
  if (!target || !(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable
    || tagName === "input"
    || tagName === "textarea"
    || tagName === "select";
}
