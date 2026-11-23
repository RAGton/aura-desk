/**
 * Integration test for the tone analyzer against a real recording.
 *
 * The fixture is a 16-bit mono WAV produced by the local Kokoro service
 * (`pf_dora`, Brazilian Portuguese, 24 kHz). It is real synthesized speech,
 * so it exercises the pitch tracker on a genuine voice rather than on a
 * synthetic sine wave.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeAuraTone } from "./auraToneAnalyzer";

interface DecodedWav {
  samples: Float32Array;
  sampleRate: number;
}

/** Minimal 16-bit PCM mono WAV reader. */
function readWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));

  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }

  let offset = 12;
  let sampleRate = 16000;
  let channels = 1;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = text(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (chunkId === "fmt ") {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (chunkId === "data") {
      dataOffset = body;
      dataLength = chunkSize;
    }
    offset = body + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0) throw new Error("no data chunk");
  if (channels !== 1) throw new Error(`expected mono, got ${channels} channels`);
  if (bitsPerSample !== 16) throw new Error(`expected 16-bit, got ${bitsPerSample}`);

  const count = Math.floor(dataLength / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    samples[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
  }
  return { samples, sampleRate };
}

const fixturePath = join(
  process.cwd(),
  "src/features/aura-chat/__fixtures__/ptbr-aura.wav"
);

describe("analyzeAuraTone (real recording)", () => {
  it("tracks the pitch of a real Brazilian Portuguese voice", async () => {
    const bytes = new Uint8Array(readFileSync(fixturePath));
    const { samples, sampleRate } = readWav(bytes);

    const analysis = await analyzeAuraTone(samples, sampleRate);

    // `pf_dora` is a female voice; the fundamental sits in the usual
    // 150–250 Hz band.
    expect(analysis.meanPitchHz).toBeGreaterThan(120);
    expect(analysis.meanPitchHz).toBeLessThan(320);
    // The sample is continuous speech, so most frames are voiced.
    expect(analysis.voicedRatio).toBeGreaterThan(0.5);
    // Loudness must be in a sane range for a normalized speech signal.
    expect(analysis.meanLoudnessDb).toBeGreaterThan(-40);
    expect(analysis.meanLoudnessDb).toBeLessThan(0);
    // The utterance is ~5 s of continuous speech.
    expect(analysis.speechRate).toBeGreaterThan(0);
  });
});
