import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AURA_STT_SAMPLE_RATE,
  floatToPcm16Le,
  probeAuraSttService,
  resampleTo16k,
  transcribeAuraAudio,
} from "./auraSpeechToText";

describe("resampleTo16k", () => {
  it("returns the same buffer when the rate already matches", () => {
    const samples = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampleTo16k(samples, AURA_STT_SAMPLE_RATE)).toBe(samples);
  });

  it("downsamples 48 kHz to 16 kHz", () => {
    const input = new Float32Array(480);
    for (let i = 0; i < input.length; i += 1) input[i] = i / 480;
    const out = resampleTo16k(input, 48000);
    // 48 kHz for 10 ms of audio is 480 samples; 16 kHz is 160.
    expect(out.length).toBe(160);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeGreaterThan(0);
  });

  it("upsamples 8 kHz to 16 kHz", () => {
    const out = resampleTo16k(new Float32Array(80), 8000);
    expect(out.length).toBe(160);
  });
});

describe("floatToPcm16Le", () => {
  it("encodes samples as little-endian signed 16-bit", () => {
    const bytes = floatToPcm16Le(new Float32Array([0, 1, -1]));

    expect(bytes).toHaveLength(6);
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(32767);
    expect(view.getInt16(4, true)).toBe(-32768);
  });

  it("clamps out-of-range samples", () => {
    const bytes = floatToPcm16Le(new Float32Array([5, -5]));
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(32767);
    expect(view.getInt16(2, true)).toBe(-32768);
  });
});

describe("transcribeAuraAudio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the audio as multipart form data and reads the transcript", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ text: "Olá, eu sou a Aura.", language: "pt", duration: 2.5 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAuraAudio(new Uint8Array([1, 2, 3, 4]), {
      language: "pt",
    });

    expect(result.text).toBe("Olá, eu sou a Aura.");
    expect(result.language).toBe("pt");
    expect(result.duration).toBe(2.5);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("throws when the service rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, text: async () => "unavailable" }))
    );

    await expect(transcribeAuraAudio(new Uint8Array([1]))).rejects.toThrow(
      /transcription error 503/
    );
  });
});

describe("probeAuraSttService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the service as available when /health answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    await expect(probeAuraSttService()).resolves.toBe(true);
  });

  it("reports the service as unavailable when the connection fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      })
    );
    await expect(probeAuraSttService()).resolves.toBe(false);
  });
});
