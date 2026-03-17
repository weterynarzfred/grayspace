import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown workspace error.";
}

export function getScreenPointFromEvent(event) {
  if (!event) return null;

  if (typeof event.screenX === "number" && typeof event.screenY === "number")
    return { x: Math.round(event.screenX), y: Math.round(event.screenY) };

  if (Array.isArray(event.touches) && event.touches[0])
    return {
      x: Math.round(event.touches[0].screenX),
      y: Math.round(event.touches[0].screenY),
    };

  return null;
}

export async function ensureWorkspaceWindowCreated(windowPayload) {
  const windowLabel = windowPayload?.windowLabel;
  if (!windowLabel) throw new Error("Window label is missing for creation.");

  const existingWindow = await WebviewWindow.getByLabel(windowLabel);
  if (existingWindow) return existingWindow;

  const bounds = windowPayload?.bounds ?? {};
  const nextWindow = new WebviewWindow(windowLabel, {
    url: window.location.href,
    title: "grayspace",
    x: typeof bounds.x === "number" ? bounds.x : undefined,
    y: typeof bounds.y === "number" ? bounds.y : undefined,
    width: typeof bounds.width === "number" ? bounds.width : undefined,
    height: typeof bounds.height === "number" ? bounds.height : undefined,
  });

  return nextWindow;
}
