import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AURA_DEFAULT_SERVICE_VOICE,
  AURA_VOICE_SAMPLE_RATE,
  listAuraServiceVoices,
  probeAuraVoiceService,
  synthesizeAuraPcm,
} from "./auraVoiceService";

/**
 * Fixture taken from a real response of `GET /v1/audio/voices` on
 * `ghcr.io/remsky/kokoro-fastapi-cpu:latest` (version 0.10.0).
 */
const REAL_VOICES_PAYLOAD = {
  voices: [
    { id: "af_heart", name: "af_heart", target_quality: "A", overall_grade: "A" },
    { id: "af_bella", name: "af_bella", target_quality: "A", overall_grade: "A-" },
    { id: "am_michael", name: "am_michael", target_quality: "B", overall_grade: "C+" },
    { id: "bf_emma", name: "bf_emma", target_quality: "B", overall_grade: "B-" },
    { id: "pf_dora", name: "pf_dora" },
    { id: "pm_alex", name: "pm_alex" },
    { id: "pm_santa", name: "pm_santa" },
    { id: "ef_dora", name: "ef_dora" },
    { id: "jf_alpha", name: "jf_alpha", overall_grade: "C+" },
    { id: "zf_xiaobei", name: "zf_xiaobei", overall_grade: "D" },
  ],
  default_voice: "af_heart",
};

function mockFetch(responses: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(responses).find((k) => url.includes(k));
    if (!key) {
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    }
    const value = responses[key];
    return {
      ok: true,
      status: 200,
      json: async () => value,
      text: async () => JSON.stringify(value),
    };
  });
}

describe("auraVoiceService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps the Kokoro voice id prefix to language and gender", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/v1/audio/voices": REAL_VOICES_PAYLOAD }));

    const voices = await listAuraServiceVoices("http://127.0.0.1:8925");
    const byId = new Map(voices.map((v) => [v.id, v]));

    expect(byId.get("pf_dora")?.language).toBe("pt-BR");
    expect(byId.get("pf_dora")?.gender).toBe("female");
    expect(byId.get("pm_alex")?.language).toBe("pt-BR");
    expect(byId.get("pm_alex")?.gender).toBe("male");
    expect(byId.get("af_heart")?.language).toBe("en-US");
    expect(byId.get("am_michael")?.language).toBe("en-US");
    expect(byId.get("am_michael")?.gender).toBe("male");
    expect(byId.get("bf_emma")?.language).toBe("en-GB");
    expect(byId.get("jf_alpha")?.language).toBe("ja-JP");
  });

  it("marks the espeak variants as degraded", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/v1/audio/voices": REAL_VOICES_PAYLOAD }));

    const voices = await listAuraServiceVoices("http://127.0.0.1:8925");
    const espeak = voices.find((v) => v.id === "ef_dora");

    expect(espeak?.espeak).toBe(true);
    expect(espeak?.language).toBe("espeak");
  });

  it("sorts Brazilian Portuguese first, then English, then the rest", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/v1/audio/voices": REAL_VOICES_PAYLOAD }));

    const voices = await listAuraServiceVoices("http://127.0.0.1:8925");
    const languages = voices.map((v) => v.language);

    expect(languages.indexOf("pt-BR")).toBeLessThan(languages.indexOf("en-US"));
    expect(languages.indexOf("en-US")).toBeLessThan(languages.indexOf("ja-JP"));
    // The espeak fallback of a pt-BR voice ranks after the real pt-BR voices.
    const dora = languages.indexOf("pt-BR");
    expect(languages.indexOf("espeak")).toBeGreaterThan(dora);
  });

  it("returns an empty catalogue when the service is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      })
    );

    await expect(listAuraServiceVoices("http://127.0.0.1:8925")).resolves.toEqual([]);
  });

  it("reports the service as unavailable when /health fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      })
    );

    const status = await probeAuraVoiceService("http://127.0.0.1:8925");
    expect(status.available).toBe(false);
    expect(status.voiceCount).toBe(0);
  });

  it("reports the service as available and counts the voices", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/health": { status: "healthy" },
        "/v1/audio/voices": REAL_VOICES_PAYLOAD,
      })
    );

    const status = await probeAuraVoiceService("http://127.0.0.1:8925");
    expect(status.available).toBe(true);
    expect(status.voiceCount).toBe(REAL_VOICES_PAYLOAD.voices.length);
  });

  it("sends an OpenAI-compatible payload and streams PCM chunks back", async () => {
    const chunks = [
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5, 6]),
    ];

    const fetchMock = vi.fn(async () => {
      let index = 0;
      return {
        ok: true,
        status: 200,
        body: {
          getReader() {
            return {
              async read() {
                if (index >= chunks.length) return { done: true, value: undefined };
                const value = chunks[index];
                index += 1;
                return { done: false, value };
              },
              releaseLock() {},
            };
          },
        },
        json: async () => ({}),
        text: async () => "",
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const received: Uint8Array[] = [];
    const total = await synthesizeAuraPcm(
      "Olá, tudo bem?",
      { voice: "pf_dora", speed: 1.1 },
      (chunk) => received.push(chunk)
    );

    expect(total).toBe(6);
    expect(received).toHaveLength(2);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe("kokoro");
    expect(body.voice).toBe("pf_dora");
    expect(body.response_format).toBe("pcm");
    expect(body.stream).toBe(true);
    expect(body.speed).toBe(1.1);
    expect(body.input).toBe("Olá, tudo bem?");
  });

  it("exposes the verified defaults", () => {
    expect(AURA_DEFAULT_SERVICE_VOICE).toBe("pf_dora");
    expect(AURA_VOICE_SAMPLE_RATE).toBe(24000);
  });
});
