import { describe, expect, it } from "vitest";
import { decodePcm16ToFloat32 } from "./auraAudioPlayer";

describe("decodePcm16ToFloat32", () => {
  it("converts little-endian signed 16-bit samples to normalized floats", () => {
    const bytes = new Uint8Array([
      0x00, 0x00, // 0
      0x00, 0x80, // -32768
      0x00, 0x40, // 16384
      0xff, 0x7f, // 32767
    ]);

    const samples = decodePcm16ToFloat32(bytes);

    expect(samples).toHaveLength(4);
    expect(samples[0]).toBe(0);
    expect(samples[1]).toBe(-1);
    expect(samples[2]).toBeCloseTo(0.5, 6);
    expect(samples[3]).toBeCloseTo(0.99997, 4);
  });

  it("ignores a trailing odd byte", () => {
    const samples = decodePcm16ToFloat32(new Uint8Array([0x00, 0x00, 0x7f]));
    expect(samples).toHaveLength(1);
  });

  it("handles an empty buffer", () => {
    expect(decodePcm16ToFloat32(new Uint8Array())).toHaveLength(0);
  });
});
