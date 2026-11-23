/**
 * Client for the local speech-to-text service.
 *
 * Backed by `fedirz/faster-whisper-server` running in Podman. Two paths are
 * used, both verified against the running container:
 *
 * - `POST /v1/audio/transcriptions` — OpenAI-compatible, one shot. Used
 *   when the user finishes recording.
 * - `WS  /v1/audio/transcriptions` — streaming. The client pushes raw
 *   16-bit little-endian mono PCM at 16 kHz and the server streams back the
 *   transcript as it grows, using VAD to decide when a chunk is complete.
 *   This is what makes the live conversation feel real-time.
 *
 * The server reads the raw PCM with `soundfile` at 16 kHz mono, so the
 * browser has to resample its microphone stream before sending it.
 */

/** Base URL of the local speech-to-text service. Bound to loopback only. */
export const AURA_STT_SERVICE_URL = "http://127.0.0.1:9000";

/** Sample rate the service expects on the wire. */
export const AURA_STT_SAMPLE_RATE = 16000;

/** A transcription result. */
export interface AuraTranscription {
  /** Full transcript of the audio that was sent. */
  text: string;
  /** Detected language, when the service reports it. */
  language?: string;
  /** Duration of the analysed audio in seconds. */
  duration?: number;
}

/**
 * Probes the local speech-to-text service.
 * Returns `false` when the service is not running.
 */
export async function probeAuraSttService(
  baseUrl: string = AURA_STT_SERVICE_URL,
  timeoutMs = 1500
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Transcribes a WAV file with the local service.
 *
 * The service resamples to 16 kHz mono internally, so any PCM WAV rate
 * works.
 */
export async function transcribeAuraAudio(
  wavBytes: Uint8Array,
  options: { language?: string; baseUrl?: string } = {}
): Promise<AuraTranscription> {
  const baseUrl = options.baseUrl ?? AURA_STT_SERVICE_URL;
  const form = new FormData();
  form.append(
    "file",
    new Blob([wavBytes as unknown as BlobPart], { type: "audio/wav" }),
    "aura-capture.wav"
  );
  if (options.language) form.append("language", options.language);

  const res = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`transcription error ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  const data = (await res.json()) as {
    text?: string;
    language?: string;
    duration?: number;
  };
  return {
    text: (data.text ?? "").trim(),
    language: data.language,
    duration: data.duration,
  };
}

/**
 * Resamples mono float samples to 16 kHz with linear interpolation.
 * Good enough for speech recognition and cheap enough to run per chunk.
 */
export function resampleTo16k(
  samples: Float32Array,
  sampleRate: number
): Float32Array {
  if (sampleRate === AURA_STT_SAMPLE_RATE) return samples;
  const ratio = AURA_STT_SAMPLE_RATE / sampleRate;
  const outLength = Math.max(1, Math.floor(samples.length * ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const position = i / ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = samples[index] ?? 0;
    const b = samples[index + 1] ?? a;
    out[i] = a + (b - a) * fraction;
  }
  return out;
}

/** Converts float samples to little-endian signed 16-bit PCM. */
export function floatToPcm16Le(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const pcm = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    view.setInt16(i * 2, pcm, true);
  }
  return out;
}

export interface AuraLiveTranscriberOptions {
  /** BCP-47 language hint, e.g. `pt` or `en`. */
  language?: string;
  /** Base URL override. */
  baseUrl?: string;
  /** Called with the growing transcript. */
  onText?: (text: string, delta: string) => void;
  /** Called when the session ends or fails. */
  onError?: (error: Error) => void;
  /** Called when the socket closes. */
  onClose?: () => void;
}

/**
 * Streaming transcription session over the service WebSocket.
 *
 * The server sends the transcript of everything it has received so far, so
 * each message carries the full text; the delta against the previous
 * message is also provided for callers that only want the new part.
 */
export class AuraLiveTranscriber {
  private socket: WebSocket | null = null;
  private lastText = "";
  private closed = false;

  constructor(private readonly options: AuraLiveTranscriberOptions = {}) {}

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Opens the streaming socket. */
  async connect(timeoutMs = 5000): Promise<void> {
    if (this.socket) return;
    const baseUrl = this.options.baseUrl ?? AURA_STT_SERVICE_URL;
    const params = new URLSearchParams();
    params.set("language", this.options.language ?? "pt");
    params.set("response_format", "json");
    params.set("vad_filter", "true");
    const url = `${baseUrl.replace(/^http/, "ws")}/v1/audio/transcriptions?${params.toString()}`;

    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("transcription service connection timed out"));
      }, timeoutMs);

      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("transcription service connection failed"));
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };

      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    }).then(
      () => {
        socket.addEventListener("message", (event) => this.handleMessage(event));
        socket.addEventListener("close", () => {
          this.closed = true;
          this.options.onClose?.();
        });
        socket.addEventListener("error", () => {
          this.options.onError?.(new Error("transcription service socket error"));
        });
      },
      (error) => {
        this.closed = true;
        throw error;
      }
    );
  }

  private handleMessage(event: MessageEvent): void {
    let text = "";
    try {
      const raw = typeof event.data === "string" ? event.data : "";
      if (!raw) return;
      const parsed = JSON.parse(raw) as { text?: string };
      text = (parsed.text ?? "").trim();
    } catch {
      return;
    }
    if (!text) return;

    const delta = text.startsWith(this.lastText)
      ? text.slice(this.lastText.length).trimStart()
      : text;
    this.lastText = text;
    this.options.onText?.(text, delta);
  }

  /**
   * Sends a block of microphone samples. The samples are resampled to
   * 16 kHz and encoded as little-endian 16-bit PCM before being pushed.
   */
  send(samples: Float32Array, sampleRate: number): void {
    const socket = this.socket;
    if (this.closed || !socket || socket.readyState !== WebSocket.OPEN) return;
    const resampled = resampleTo16k(samples, sampleRate);
    const pcm = floatToPcm16Le(resampled);
    socket.send(pcm);
  }

  /** Closes the session. */
  close(): void {
    this.closed = true;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      socket.close();
    } catch {
      // ignore
    }
  }
}
