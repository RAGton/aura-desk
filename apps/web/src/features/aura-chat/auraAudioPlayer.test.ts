import { afterEach, describe, expect, it, vi } from "vitest";
import { AuraAudioPlayer, decodePcm16ToFloat32 } from "./auraAudioPlayer";

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

describe("AuraAudioPlayer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubAudioContext() {
    const writtenChannels: Float32Array[] = [];
    let currentTime = 0;

    class MockAudioContext {
      get currentTime() {
        return currentTime;
      }
      state = "running";
      destination = {};
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
      createGain() {
        return { connect: vi.fn() };
      }
      createBuffer(_channels: number, length: number, sampleRate: number) {
        return {
          duration: length / sampleRate,
          copyToChannel(src: Float32Array) {
            writtenChannels.push(Float32Array.from(src));
          },
        };
      }
      createBufferSource() {
        return {
          buffer: null,
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          onended: null as (() => void) | null,
        };
      }
    }

    vi.stubGlobal("AudioContext", MockAudioContext);
    return {
      writtenChannels,
      advanceTime: (sec: number) => {
        currentTime += sec;
      },
    };
  }

  it("preserves 16-bit PCM sample alignment across odd-sized streamed chunks", () => {
    const { writtenChannels } = stubAudioContext();
    const player = new AuraAudioPlayer();

    // 100 samples => 200 bytes (values 100, 200, ... avoids byte-swap corruption test ambiguity)
    const raw = new Uint8Array(200);
    const view = new DataView(raw.buffer);
    for (let i = 0; i < 100; i += 1) {
      view.setInt16(i * 2, (i - 50) * 400, true);
    }

    // Split across odd-sized boundaries: 3, 1, 5, 1, rest (190 -> wait: make last odd too if exact)
    player.play(raw.subarray(0, 3));
    player.play(raw.subarray(3, 4));
    player.play(raw.subarray(4, 9));
    player.play(raw.subarray(9, 10));
    player.play(raw.subarray(10));

    const combined = writtenChannels.flatMap((c) => Array.from(c));
    expect(combined).toHaveLength(100);

    const expected = decodePcm16ToFloat32(raw);
    // Samples after the initial 72-sample idle fade-in must match identically (no swapped bytes)
    for (let i = 72; i < 100; i += 1) {
      expect(combined[i]).toBeCloseTo(expected[i], 6);
    }
  });

  it("clears pending trailing byte on resetStreamAlignment and stop", () => {
    const { writtenChannels } = stubAudioContext();
    const player = new AuraAudioPlayer();

    // Odd 3-byte chunk leaves 1 pending byte
    player.play(new Uint8Array([0x00, 0x10, 0xff]));
    expect(writtenChannels).toHaveLength(1);
    expect(writtenChannels[0]).toHaveLength(1);

    // Clearing alignment drops the orphan trailing byte before next sentence
    player.resetStreamAlignment();
    player.play(new Uint8Array([0x00, 0x20]));
    expect(writtenChannels).toHaveLength(2);
    expect(writtenChannels[1]).toHaveLength(1);
    expect(writtenChannels[1][0]).toBeCloseTo(0x2000 / 32768, 6);

    // Odd 1-byte chunk followed by stop() + reset() must not bleed into next stream
    player.play(new Uint8Array([0x7f]));
    player.stop();
    player.reset();
    player.play(new Uint8Array([0x00, 0x40]));
    expect(writtenChannels).toHaveLength(3);
    expect(writtenChannels[2]).toHaveLength(1);
  });
});
