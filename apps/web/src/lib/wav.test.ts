import { describe, expect, it } from "vitest";
import { encodePcm16Wav, encodePcm16WavBase64, mergeFloat32Chunks } from "./wav";

describe("wav encoder", () => {
  it("merges chunks and writes a valid 16-bit mono PCM RIFF/WAVE header", () => {
    const chunkA = new Float32Array([0, 0.5]);
    const chunkB = new Float32Array([-0.5, 1.5, -2.0]); // tests clamping above/below [-1, 1]
    const merged = mergeFloat32Chunks([chunkA, chunkB]);
    expect(merged).toHaveLength(5);

    const wav = encodePcm16Wav(merged, 16_000);
    expect(wav.byteLength).toBe(44 + 5 * 2);

    const textDecoder = new TextDecoder("ascii");
    expect(textDecoder.decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(textDecoder.decode(wav.subarray(8, 12))).toBe("WAVE");
    expect(textDecoder.decode(wav.subarray(12, 16))).toBe("fmt ");
    expect(textDecoder.decode(wav.subarray(36, 40))).toBe("data");

    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(4, true)).toBe(36 + 10);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(50, true)).toBe(0x7fff);
    expect(view.getInt16(52, true)).toBe(-0x8000);
  });

  it("encodes base64 WAV payload starting with RIFF signature", () => {
    const b64 = encodePcm16WavBase64([new Float32Array([0.1, -0.1])], 8_000);
    const decoded = atob(b64);
    expect(decoded.startsWith("RIFF")).toBe(true);
    expect(decoded.slice(8, 12)).toBe("WAVE");
    expect(decoded.length).toBe(44 + 4);
  });
});
