import "@testing-library/jest-dom/vitest";

if (globalThis.ResizeObserver === undefined) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() { /* no-op stub for jsdom */ }

    unobserve() { /* no-op stub for jsdom */ }

    disconnect() { /* no-op stub for jsdom */ }
  };
}

if (typeof HTMLCanvasElement !== "undefined") {
  const context2dStub = {
    canvas: null,
    clearRect() { },
    fillRect() { },
    drawImage() { },
    beginPath() { },
    closePath() { },
    moveTo() { },
    lineTo() { },
    stroke() { },
    fillText() { },
    setTransform() { },
    save() { },
    restore() { },
    measureText(text = "") {
      return { width: String(text).length * 8 };
    },
    getImageData() {
      return { data: new Uint8ClampedArray(0) };
    },
    putImageData() { },
  };

  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: () => context2dStub,
  });
}
