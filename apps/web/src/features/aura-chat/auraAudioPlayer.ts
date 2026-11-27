/**
 * Gapless PCM playback for the Aura voice.
 *
 * The local Kokoro service streams raw signed 16-bit little-endian mono PCM
 * at 24 kHz (no WAV header). This player converts each streamed chunk into a
 * Web Audio buffer and schedules it right after the previous chunk, so a
 * reply is audible sentence-by-sentence while the next one is still being
 * synthesized.
 */

import { AURA_VOICE_SAMPLE_RATE } from "./auraVoiceService";

/** Converts little-endian signed 16-bit PCM into normalized float samples. */
export function decodePcm16ToFloat32(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Allocate over an explicit ArrayBuffer so the result is
  // `Float32Array<ArrayBuffer>` (required by `AudioBuffer.copyToChannel`).
  const out = new Float32Array(new ArrayBuffer(sampleCount * 4));
  for (let i = 0; i < sampleCount; i += 1) {
    // 32768 instead of 32767 so -32768 maps to exactly -1.0.
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

/**
 * Sequential PCM player. Chunks are queued on a single audio context so the
 * playback never restarts or gaps between sentences.
 */
export class AuraAudioPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private nextStartTime = 0;
  private activeSources = new Set<AudioBufferSourceNode>();
  private stopped = false;
  private pendingByte: number | null = null;

  /** Clears any trailing odd byte at stream/sentence boundaries without stopping playback. */
  resetStreamAlignment(): void {
    this.pendingByte = null;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
      this.nextStartTime = this.ctx.currentTime;
    }
    return this.ctx;
  }

  /**
   * Resumes the audio context after an autoplay block.
   * Must be called from a user gesture on first playback.
   */
  async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // ignore — playback will start on the next user interaction
      }
    }
  }

  /** Queues a raw PCM chunk for immediate playback. */
  play(chunk: Uint8Array): void {
    if (this.stopped || chunk.byteLength === 0) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.gain) return;

    // Preserve sample alignment across arbitrary HTTP stream chunk boundaries.
    const prefixLen = this.pendingByte !== null ? 1 : 0;
    const totalBytes = prefixLen + chunk.byteLength;
    if (totalBytes < 2) {
      this.pendingByte = chunk[0];
      return;
    }

    const evenBytes = totalBytes & ~1;
    const nextPending = totalBytes % 2 === 1 ? chunk[chunk.byteLength - 1] : null;
    let aligned: Uint8Array;
    if (prefixLen === 0) {
      aligned = nextPending === null ? chunk : chunk.subarray(0, evenBytes);
    } else {
      aligned = new Uint8Array(evenBytes);
      aligned[0] = this.pendingByte!;
      aligned.set(chunk.subarray(0, evenBytes - 1), 1);
    }
    this.pendingByte = nextPending;

    const samples = decodePcm16ToFloat32(aligned);
    if (samples.length === 0) return;

    const now = ctx.currentTime;
    const isIdleStart = this.nextStartTime <= now;
    if (isIdleStart) {
      const fadeLen = Math.min(72, samples.length);
      for (let i = 0; i < fadeLen; i += 1) {
        samples[i] *= i / fadeLen;
      }
    }

    const buffer = ctx.createBuffer(1, samples.length, AURA_VOICE_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);

    // Schedule right after whatever is already queued; give idle starts a 25ms cushion.
    const startAt = isIdleStart ? now + 0.025 : this.nextStartTime;
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
    };
  }

  /** True while at least one chunk is still queued or playing. */
  get isPlaying(): boolean {
    if (this.activeSources.size > 0) return true;
    if (!this.ctx) return false;
    return this.nextStartTime > this.ctx.currentTime;
  }

  /** Stops all queued/playing audio immediately. */
  stop(): void {
    this.stopped = true;
    this.pendingByte = null;
    for (const source of this.activeSources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // ignore — the source may already have ended
      }
    }
    this.activeSources.clear();
    if (this.ctx) {
      this.nextStartTime = this.ctx.currentTime;
    }
  }

  /** Resets the player so it can be reused after a `stop()`. */
  reset(): void {
    this.stop();
    this.stopped = false;
  }

  /** Releases the audio context. */
  dispose(): void {
    this.stop();
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        // ignore
      }
    }
    this.ctx = null;
    this.gain = null;
  }
}
