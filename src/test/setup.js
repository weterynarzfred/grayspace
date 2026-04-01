import "@testing-library/jest-dom/vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}

    unobserve() {}

    disconnect() {}
  };
}

if (typeof HTMLCanvasElement !== "undefined") {
  const context2dStub = {
    canvas: null,
    clearRect() {},
    fillRect() {},
    drawImage() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {},
    setTransform() {},
    save() {},
    restore() {},
    measureText(text = "") {
      return { width: String(text).length * 8 };
    },
    getImageData() {
      return { data: new Uint8ClampedArray(0) };
    },
    putImageData() {},
  };

  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: () => context2dStub,
  });
}
