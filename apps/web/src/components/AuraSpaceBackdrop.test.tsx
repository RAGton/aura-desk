import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuraSpaceBackdrop } from "./AuraSpaceBackdrop";

function createMockWebGlContext() {
  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    BLEND: 0x0be2,
    TRIANGLES: 0x0004,
    POINTS: 0x0000,
    SRC_ALPHA: 0x0302,
    ONE: 0x0001,
    ZERO: 0x0000,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    deleteProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    viewport: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    blendFuncSeparate: vi.fn(),
    useProgram: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn(() => ({})),
    uniform2f: vi.fn(),
    uniform1f: vi.fn(),
    drawArrays: vi.fn(),
  };
}

describe("AuraSpaceBackdrop", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalRaf = window.requestAnimationFrame;
  const originalCaf = window.cancelAnimationFrame;

  beforeEach(() => {
    document.documentElement.dataset.theme = "dark";
    let rafCount = 0;
    window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      rafCount += 1;
      if (rafCount <= 1) {
        cb(16);
      }
      return rafCount;
    });
    window.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCaf;
    document.documentElement.dataset.theme = "dark";
  });

  it("renders contained galaxyDark WebGL shaders even under global light theme and cleans up on unmount", () => {
    document.documentElement.dataset.theme = "light";
    const gl = createMockWebGlContext();
    HTMLCanvasElement.prototype.getContext = vi.fn(function (contextId: string) {
      if (contextId === "webgl2" || contextId === "webgl") {
        return gl as unknown as RenderingContext;
      }
      return null;
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const { unmount } = render(<AuraSpaceBackdrop contained immersive galaxyDark />);

    const backdrop = screen.getByTestId("aura-space-backdrop");
    expect(backdrop).toHaveClass("pointer-events-none", "absolute", "inset-0");
    expect(backdrop.querySelector(".aura-galaxy-nebula-dark")).not.toBeNull();
    expect(gl.createProgram).toHaveBeenCalledTimes(2);
    expect(gl.drawArrays).toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("auradesk://camera-orbit", {
          detail: { yaw: 1.2, pitch: 0.4, zoom: 1.5 },
        })
      );
      window.dispatchEvent(new Event("resize"));
    });

    unmount();
    expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(2);
  });

  it("uses 2D star fallback when WebGL is unavailable and respects washed-out light mode when galaxyDark is false", () => {
    document.documentElement.dataset.theme = "light";
    const gradient = { addColorStop: vi.fn() };
    const ctx2d = {
      createLinearGradient: vi.fn(() => gradient),
      createRadialGradient: vi.fn(() => gradient),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillStyle: "",
      globalAlpha: 1,
    };
    HTMLCanvasElement.prototype.getContext = vi.fn(function (contextId: string) {
      if (contextId === "2d") {
        return ctx2d as unknown as RenderingContext;
      }
      return null;
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    render(<AuraSpaceBackdrop galaxyDark={false} />);

    const backdrop = screen.getByTestId("aura-space-backdrop");
    expect(backdrop).toHaveClass("fixed");
    const canvas = backdrop.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveClass("opacity-90");
    expect(ctx2d.fillRect).toHaveBeenCalled();
  });
});
