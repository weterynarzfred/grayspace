export const APP_COMMAND_EVENT = "grayspace-command";

export function dispatchAppCommand(commandId, context = {}) {
  window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, {
    detail: {
      commandId,
      context,
    },
  }));
}
