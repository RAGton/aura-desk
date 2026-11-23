/**
 * Live conversation voice session.
 *
 * Owns the round trip that makes the live mode feel real-time:
 *
 *   microphone → PCM → Whisper (WebSocket) → growing transcript
 *                                            → utterance boundary → Aura
 *   microphone → PCM → tone analysis (prosody + optional emotion model)
 *
 * The Whisper service returns the transcript of *everything* it has heard
 * so far, so this session tracks how much was already delivered and cuts
 * new utterances out of the growing text.
 */

import { analyzeAuraTone, type AuraToneAnalysis } from "./auraToneAnalyzer";
import { AuraLiveTranscriber } from "./auraSpeechToText";

/** Silence after which the current utterance is considered finished. */
const UTTERANCE_SILENCE_MS = 1400;

export interface AuraLiveVoiceOptions {
  /** Language hint for the transcription service (`pt` or `en`). */
  language?: string;
  /** Sample rate of the microphone stream. */
  sampleRate: number;
  /** Called with the transcript as it grows. */
  onInterim?: (text: string) => void;
  /** Called when an utterance is complete and should be sent to Aura. */
  onFinal?: (text: string) => void;
  /** Called with the tone analysis of a finished utterance. */
  onTone?: (analysis: AuraToneAnalysis) => void;
  /** Called when the session fails. */
  onError?: (error: Error) => void;
}

export class AuraLiveVoiceSession {
  private transcriber: AuraLiveTranscriber | null = null;
  private serverText = "";
  private sentOffset = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private utteranceSamples: number[] = [];
  private currentSampleRate: number;
  private stopped = false;

  constructor(private readonly options: AuraLiveVoiceOptions) {
    this.currentSampleRate = options.sampleRate;
  }

  /** Opens the streaming transcription session. */
  async start(): Promise<boolean> {
    const transcriber = new AuraLiveTranscriber({
      language: this.options.language ?? "pt",
      onText: (text) => this.handleText(text),
      onClose: () => this.flushUtterance(),
      onError: (error) => this.options.onError?.(error),
    });

    try {
      await transcriber.connect();
    } catch (error) {
      this.options.onError?.(
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }

    this.transcriber = transcriber;
    return true;
  }

  /** True when the streaming session is up. */
  get isActive(): boolean {
    return this.transcriber?.isConnected ?? false;
  }

  /**
   * Feeds microphone samples. The session keeps a copy for the tone
   * analysis of the current utterance.
   *
   * The sample rate is passed per chunk because the browser only reveals
   * the real rate once the AudioContext exists.
   */
  push(samples: Float32Array, sampleRate?: number): void {
    if (this.stopped || !this.transcriber) return;
    const rate = sampleRate ?? this.options.sampleRate;
    this.currentSampleRate = rate;
    this.utteranceSamples.push(...samples);
    this.transcriber.send(samples, rate);
  }

  /**
   * Ends the session. Any pending text is delivered as a final utterance
   * and the tone of the last utterance is analysed.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.transcriber?.close();
    this.transcriber = null;

    this.flushUtterance();
    await this.analyzeTone();
  }

  private handleText(text: string): void {
    if (this.stopped) return;

    this.serverText = text;
    this.options.onInterim?.(text.slice(this.sentOffset).trimStart() || text);

    // The user paused: the utterance is complete.
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      this.flushUtterance();
    }, UTTERANCE_SILENCE_MS);
  }

  private flushUtterance(): void {
    if (this.stopped && this.sentOffset >= this.serverText.length) return;

    const pending = this.serverText.slice(this.sentOffset).trim();
    if (!pending) return;

    this.sentOffset = this.serverText.length;
    this.options.onFinal?.(pending);

    // The tone of the utterance that just ended.
    void this.analyzeTone();
  }

  private async analyzeTone(): Promise<void> {
    if (this.utteranceSamples.length === 0) return;
    const samples = Float32Array.from(this.utteranceSamples);
    this.utteranceSamples = [];
    try {
      const analysis = await analyzeAuraTone(samples, this.currentSampleRate);
      this.options.onTone?.(analysis);
    } catch (error) {
      this.options.onError?.(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}
