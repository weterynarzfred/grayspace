import { act } from "@testing-library/react";

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
