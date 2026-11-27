/**
 * Client for the local Kokoro TTS service (`kokoro-fastapi` running in
 * Podman). Every endpoint and payload shape below was verified against the
 * running container (image `ghcr.io/remsky/kokoro-fastapi-cpu:latest`,
 * version 0.10.0):
 *
 *   GET  /health              -> { "status": "healthy" }
 *   GET  /v1/audio/voices     -> { voices: [...], default_voice: "af_heart" }
 *   POST /v1/audio/speech     -> OpenAI-compatible synthesis
 *   WS   /v1/realtime         -> OpenAI-Realtime-compatible streaming
 *
 * The container listens on port 8880 internally (the image metadata
 * advertises 8000/tcp, which is wrong — the entrypoint runs uvicorn with
 * `PORT=8880`). `scripts/setup_voice_podman.sh` and the Rust service
 * manager both map `127.0.0.1:8925 -> 8880`.
 */

import { isTauriRuntime } from "../../lib/ipc";

/** Base URL of the local voice service. Bound to loopback only. */
export const AURA_VOICE_SERVICE_URL = "http://127.0.0.1:8925";

function resolveVoiceHttpBaseUrl(baseUrl: string): string {
  const metaEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const isVitest = Boolean(metaEnv?.VITEST) || metaEnv?.MODE === "test";
  if (
    baseUrl === AURA_VOICE_SERVICE_URL &&
    !isVitest &&
    !isTauriRuntime() &&
    typeof window !== "undefined" &&
    window.location.protocol.startsWith("http")
  ) {
    return "/__voice";
  }
  return baseUrl;
}

/** Sample rate of the PCM produced by the service (Kokoro native rate). */
export const AURA_VOICE_SAMPLE_RATE = 24000;

/** Default voice: Brazilian Portuguese female, highest available grade. */
export const AURA_DEFAULT_SERVICE_VOICE = "pf_dora";

/**
 * Voice-id prefix to language. The second letter of a Kokoro voice id is the
 * gender (`f` female, `m` male); the first letter selects the phoneme
 * pipeline inside `misaki`.
 */
const PREFIX_LANGUAGES: Record<string, { code: string; label: string }> = {
  a: { code: "en-US", label: "English (US)" },
  b: { code: "en-GB", label: "English (UK)" },
  e: { code: "espeak", label: "espeak fallback" },
  f: { code: "fr-FR", label: "Français" },
  h: { code: "hi-IN", label: "हिन्दी" },
  i: { code: "it-IT", label: "Italiano" },
  j: { code: "ja-JP", label: "日本語" },
  p: { code: "pt-BR", label: "Português (BR)" },
  z: { code: "zh-CN", label: "中文" },
};

export interface AuraServiceVoice {
  /** Kokoro voice id, e.g. `pf_dora`. */
  id: string;
  /** Human label, e.g. `Dora (pt-BR)`. */
  label: string;
  /** Pipeline prefix letter (`a`, `p`, `b`, ...). */
  langCode: string;
  /** BCP-47 language tag (`pt-BR`, `en-US`, ...) or `espeak`. */
  language: string;
  /** Display label for the language. */
  languageLabel: string;
  /** Gender inferred from the second letter of the voice id. */
  gender: "female" | "male";
  /** Overall quality grade reported by the service (A, B-, C+, ...). */
  grade?: string;
  /** True for the `e*` espeak variants — same voice, degraded pronunciation. */
  espeak: boolean;
}

/** Raw shape returned by `GET /v1/audio/voices`. */
interface RawServiceVoice {
  id: string;
  name?: string;
  overall_grade?: string | null;
  target_quality?: string | null;
}

function describeVoice(raw: RawServiceVoice): AuraServiceVoice {
  const id = raw.id;
  const prefix = (id[0] ?? "").toLowerCase();
  const genderLetter = (id[1] ?? "").toLowerCase();
  const lang = PREFIX_LANGUAGES[prefix] ?? { code: "und", label: "Other" };
  const gender: "female" | "male" = genderLetter === "f" ? "female" : "male";
  const espeak = prefix === "e";
  const grade = raw.overall_grade ?? raw.target_quality ?? undefined;

  // Friendly names for the voices that actually matter for Aura, so the
  // picker is not a wall of Kokoro ids.
  const friendly: Record<string, string> = {
    pf_dora: "Dora",
    pm_alex: "Alex",
    pm_santa: "Santa",
    af_heart: "Heart",
    af_bella: "Bella",
    af_nicole: "Nicole",
    af_nova: "Nova",
    af_sarah: "Sarah",
    af_sky: "Sky",
    af_kore: "Kore",
    af_aoede: "Aoede",
    af_alloy: "Alloy",
    am_michael: "Michael",
    am_fenrir: "Fenrir",
    am_puck: "Puck",
    am_eric: "Eric",
    am_echo: "Echo",
    am_liam: "Liam",
    am_onyx: "Onyx",
    am_adam: "Adam",
    am_santa: "Santa",
    bf_emma: "Emma",
    bf_isabella: "Isabella",
    bf_alice: "Alice",
    bf_lily: "Lily",
    bm_george: "George",
    bm_fable: "Fable",
    bm_daniel: "Daniel",
    bm_lewis: "Lewis",
    bm_atten_inno: "Atten",
  };

  const baseName = friendly[id] ?? id.replace(/^[a-z]{2}_/, "");
  const label = espeak ? `${baseName} (espeak)` : baseName;

  return {
    id,
    label,
    langCode: prefix,
    language: lang.code,
    languageLabel: lang.label,
    gender,
    grade,
    espeak,
  };
}

/**
 * Fetches the voice catalogue from the local service.
 * Returns an empty array when the service is not running.
 */
export async function listAuraServiceVoices(
  baseUrl: string = AURA_VOICE_SERVICE_URL
): Promise<AuraServiceVoice[]> {
  try {
    const res = await fetch(`${resolveVoiceHttpBaseUrl(baseUrl)}/v1/audio/voices`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { voices?: RawServiceVoice[] };
    if (!Array.isArray(data.voices)) return [];

    return data.voices
      .filter((v) => typeof v?.id === "string" && v.id.length > 2)
      .map(describeVoice)
      .sort((a, b) => {
        // pt-BR first (Aura speaks Brazilian Portuguese), then English, then
        // the rest. Within a language: espeak variants last, better grade
        // first, female before male.
        const langRank = (v: AuraServiceVoice) => {
          if (v.language === "pt-BR" && !v.espeak) return 0;
          if (v.language === "pt-BR") return 1;
          if (v.language === "en-US" || v.language === "en-GB") return 2;
          return 3;
        };
        const byLang = langRank(a) - langRank(b);
        if (byLang !== 0) return byLang;
        const byEspeak = Number(a.espeak) - Number(b.espeak);
        if (byEspeak !== 0) return byEspeak;
        const byGender = a.gender === b.gender ? 0 : a.gender === "female" ? -1 : 1;
        if (byGender !== 0) return byGender;
        return a.id.localeCompare(b.id);
      });
  } catch {
    return [];
  }
}

/** Result of probing the local voice service. */
export interface AuraVoiceServiceStatus {
  /** True when the service answered `/health` with `healthy`. */
  available: boolean;
  /** Number of voices exposed by the service. */
  voiceCount: number;
  /** The service's own default voice id. */
  defaultVoice?: string;
}

/**
 * Cheap health probe. Used by the UI to decide between the neural voice
 * service and the browser `SpeechSynthesis` fallback.
 */
export async function probeAuraVoiceService(
  baseUrl: string = AURA_VOICE_SERVICE_URL,
  timeoutMs = 1500
): Promise<AuraVoiceServiceStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resolvedBase = resolveVoiceHttpBaseUrl(baseUrl);
    const res = await fetch(`${resolvedBase}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!res.ok) return { available: false, voiceCount: 0 };
    const data = (await res.json().catch(() => ({}))) as { status?: string };
    if (data.status !== "healthy") return { available: false, voiceCount: 0 };

    const voices = await listAuraServiceVoices(resolvedBase);
    return {
      available: true,
      voiceCount: voices.length,
      defaultVoice: AURA_DEFAULT_SERVICE_VOICE,
    };
  } catch {
    return { available: false, voiceCount: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export interface AuraSynthesisOptions {
  /** Kokoro voice id, or an inline blend such as `pf_dora(2)+pm_alex`. */
  voice: string;
  /** Speech rate, 0.25–4.0 (the service accepts this range). */
  speed?: number;
  /** Optional explicit language pipeline override. */
  langCode?: string;
  /** Base URL override. */
  baseUrl?: string;
}

/**
 * Synthesizes `text` and hands each streamed chunk to `onChunk`.
 *
 * The service splits the input into sentences and streams one sentence per
 * chunk, so playback can start before the whole reply is synthesized. Chunks
 * are raw signed 16-bit little-endian mono PCM at 24 kHz (no header).
 *
 * Returns the total number of audio bytes received.
 */
export async function synthesizeAuraPcm(
  text: string,
  options: AuraSynthesisOptions,
  onChunk?: (chunk: Uint8Array) => void
): Promise<number> {
  const baseUrl = resolveVoiceHttpBaseUrl(options.baseUrl ?? AURA_VOICE_SERVICE_URL);
  const body: Record<string, unknown> = {
    model: "kokoro",
    input: text,
    voice: options.voice,
    response_format: "pcm",
    stream: true,
  };
  if (typeof options.speed === "number") body.speed = options.speed;
  if (options.langCode) body.lang_code = options.langCode;

  const res = await fetch(`${baseUrl}/v1/audio/speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`voice service error ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  const bodyStream = res.body;
  if (!bodyStream) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onChunk?.(buf);
    return buf.byteLength;
  }

  const reader = bodyStream.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        total += value.byteLength;
        onChunk?.(value);
      }
    }
  } finally {
    reader.releaseLock?.();
  }
  return total;
}

/**
 * OpenAI-Realtime-compatible streaming session.
 *
 * The wire protocol (verified against the running container):
 *   server -> `session.created`
 *   client -> `session.update`  { session: { audio: { output: { voice, speed } } } }
 *   client -> `response.create` { response: { input: [{ type: "message",
 *             role: "user", content: [{ type: "input_text", text }] }] } }
 *   server -> `response.output_audio.delta` { delta: <base64 PCM> }
 *   server -> `response.output_audio.done` / `response.done`
 *   client -> `response.cancel` { response_id }
 */
export class AuraRealtimeSession {
  private socket: WebSocket | null = null;
  private connected = false;

  constructor(
    private readonly baseUrl: string = AURA_VOICE_SERVICE_URL,
    private readonly voice: string = AURA_DEFAULT_SERVICE_VOICE,
    private readonly speed: number = 1.0
  ) {}

  get isConnected(): boolean {
    return this.connected;
  }

  /**
   * Opens the socket and resolves once `session.created` arrives.
   * Rejects if the socket cannot be established within `timeoutMs`.
   */
  async connect(timeoutMs = 4000): Promise<void> {
    if (this.socket) return;
    const wsUrl = `${this.baseUrl.replace(/^http/, "ws")}/v1/realtime`;
    const socket = new WebSocket(wsUrl);
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("voice service realtime timeout"));
      }, timeoutMs);

      const onOpen = () => {
        socket.send(
          JSON.stringify({
            type: "session.update",
            session: {
              audio: {
                output: {
                  format: { type: "audio/pcm", rate: AURA_VOICE_SAMPLE_RATE },
                  voice: this.voice,
                  speed: this.speed,
                },
              },
            },
          })
        );
      };

      const onMessage = (event: MessageEvent) => {
        let parsed: { type?: string };
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (parsed.type === "session.created") {
          cleanup();
          resolve();
        }
      };

      const onError = () => {
        cleanup();
        reject(new Error("voice service realtime connection failed"));
      };

      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onError);
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("message", onMessage);
      socket.addEventListener("error", onError);
    }).then(
      () => {
        this.connected = true;
        socket.addEventListener("close", () => {
          this.connected = false;
        });
      },
      (err) => {
        try {
          socket.close();
        } catch {
          // ignore
        }
        this.socket = null;
        throw err;
      }
    );
  }

  /**
   * Speaks `text`. `onChunk` receives raw PCM bytes as they arrive.
   * Resolves when the server signals `response.output_audio.done`.
   */
  async speak(text: string, onChunk?: (chunk: Uint8Array) => void): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("voice service realtime socket is not open");
    }
    const trimmed = text.trim();
    if (!trimmed) return;

    await new Promise<void>((resolve, reject) => {
      const socket = this.socket as WebSocket;
      const onMessage = (event: MessageEvent) => {
        let parsed: {
          type?: string;
          delta?: string;
          error?: { message?: string };
          response?: { status?: string };
        };
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (parsed.type === "response.output_audio.delta" && parsed.delta) {
          const binary = atob(parsed.delta);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
          }
          onChunk?.(bytes);
          return;
        }

        if (parsed.type === "response.output_audio.done" || parsed.type === "response.done") {
          socket.removeEventListener("message", onMessage);
          socket.removeEventListener("error", onError);
          if (parsed.type === "response.done" && parsed.response?.status === "failed") {
            reject(new Error("voice service realtime synthesis failed"));
            return;
          }
          resolve();
          return;
        }

        if (parsed.type === "error") {
          socket.removeEventListener("message", onMessage);
          socket.removeEventListener("error", onError);
          reject(new Error(parsed.error?.message ?? "voice service realtime error"));
        }
      };

      const onError = () => {
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onError);
        reject(new Error("voice service realtime socket error"));
      };

      socket.addEventListener("message", onMessage);
      socket.addEventListener("error", onError);

      socket.send(
        JSON.stringify({
          type: "response.create",
          response: {
            input: [
              {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: trimmed }],
              },
            ],
          },
        })
      );
    });
  }

  /** Stops any in-flight synthesis (barge-in). */
  cancel(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify({ type: "response.cancel" }));
    } catch {
      // ignore
    }
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    if (!socket) return;
    try {
      socket.close();
    } catch {
      // ignore
    }
  }
}
