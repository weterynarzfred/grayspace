import { act } from "@testing-library/react";
import { vi } from "vitest";

export async function advanceTimersBy(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

