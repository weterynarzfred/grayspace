import { render, waitFor } from "@testing-library/react";
import FloatingPopover from "./FloatingPopover";

describe("FloatingPopover", () => {
  it("keeps popovers inside the viewport near bottom-right edges", async () => {
    const getBoundingClientRectMock = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 300,
        bottom: 200,
        width: 300,
        height: 200,
        toJSON: () => ({}),
      });

    const { container } = render(<FloatingPopover
      open
      position={{ x: window.innerWidth, y: window.innerHeight }}
    >
      <div>Popover content</div>
    </FloatingPopover>);

    await waitFor(() => {
      const popover = container.firstChild;
      expect(popover).toBeTruthy();
      expect(popover.style.left).toBe("716px");
      expect(popover.style.top).toBe("560px");
    });

    getBoundingClientRectMock.mockRestore();
  });
});
