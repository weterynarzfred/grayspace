import { act } from "@testing-library/react";

export async function flushPromises(ms = 50) {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
    // drain microtasks queued during the timer (e.g. async mock resolutions)
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

export function runInAct(handler) {
  return (...args) => {
    let result;
    act(() => {
      result = handler?.(...args);
    });
    return result;
  };
}

export function runInAsyncAct(handler) {
  return async (...args) => {
    let result;
    await act(async () => {
      result = await handler?.(...args);
    });
    return result;
  };
}
