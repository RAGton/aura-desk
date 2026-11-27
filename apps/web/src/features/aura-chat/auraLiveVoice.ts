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
 * so far (and can re-decode or roll its window), so this session normalizes
 * spacing, collapses repeated Whisper phrases, strips committed prefixes or
 * rolling overlaps, and delivers clean utterances to Aura.
 */

import { analyzeAuraTone, type AuraToneAnalysis } from "./auraToneAnalyzer";
import { AuraLiveTranscriber } from "./auraSpeechToText";

/** Silence after which the current utterance is considered finished. */
const UTTERANCE_SILENCE_MS = 1800;

export function normalizeTranscriptText(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function toWordToken(word: string): string {
  return word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function tokensEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function collapseRepeatedPhrases(text: string): string {
  let current = normalizeTranscriptText(text);
  if (!current) return "";

  let changed = true;
  while (changed) {
    changed = false;
    const words = current.split(" ").filter(Boolean);
    if (words.length < 4) break;
    const tokens = words.map(toWordToken);

    let nextWords: string[] | null = null;
    for (let i = 0; i < words.length && !nextWords; i += 1) {
      const maxK = Math.floor((words.length - i) / 2);
      for (let k = maxK; k >= 2; k -= 1) {
        let match = true;
        for (let offset = 0; offset < k; offset += 1) {
          const left = tokens[i + offset];
          const right = tokens[i + k + offset];
          if (!left || left !== right) {
            match = false;
            break;
          }
        }
        if (match) {
          // Keep the second copy since Whisper's newer tail often carries
          // finalized punctuation and casing.
          nextWords = [...words.slice(0, i), ...words.slice(i + k)];
          break;
        }
      }
    }

    if (nextWords) {
      current = normalizeTranscriptText(nextWords.join(" "));
      changed = true;
    }
  }

  return current;
}

export function extractNextUtterance(
  committedText: string,
  incomingRaw: string,
  lastEmittedUtterance?: string
): string {
  const normalizedIncoming = collapseRepeatedPhrases(normalizeTranscriptText(incomingRaw));
  if (!normalizedIncoming) return "";

  const incomingWords = normalizedIncoming.split(" ").filter(Boolean);
  const incomingTokens = incomingWords.map(toWordToken);
  const normalizedCommitted = collapseRepeatedPhrases(normalizeTranscriptText(committedText));

  let remainingWords = incomingWords;
  if (normalizedCommitted) {
    const committedWords = normalizedCommitted.split(" ").filter(Boolean);
    const committedTokens = committedWords.map(toWordToken);

    let prefixLen = 0;
    const minLen = Math.min(committedTokens.length, incomingTokens.length);
    while (prefixLen < minLen && committedTokens[prefixLen] === incomingTokens[prefixLen]) {
      prefixLen += 1;
    }

    if (prefixLen > 0) {
      remainingWords = incomingWords.slice(prefixLen);
    } else {
      let overlap = 0;
      const maxOverlap = Math.min(committedTokens.length, incomingTokens.length);
      for (let k = maxOverlap; k >= 1; k -= 1) {
        if (k === 1 && committedTokens.length !== 1) continue;
        let matches = true;
        for (let j = 0; j < k; j += 1) {
          if (committedTokens[committedTokens.length - k + j] !== incomingTokens[j]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          overlap = k;
          break;
        }
      }
      if (overlap > 0) {
        remainingWords = incomingWords.slice(overlap);
      }
    }
  }

  const pending = collapseRepeatedPhrases(normalizeTranscriptText(remainingWords.join(" ")));
  if (!pending) return "";

  if (lastEmittedUtterance) {
    const lastNormalized = collapseRepeatedPhrases(normalizeTranscriptText(lastEmittedUtterance));
    const lastTokens = lastNormalized.split(" ").filter(Boolean).map(toWordToken);
    const pendingTokens = pending.split(" ").filter(Boolean).map(toWordToken);
    if (lastTokens.length > 0 && tokensEqual(lastTokens, pendingTokens)) {
      return "";
    }
  }

  return pending;
}

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
  private committedText = "";
  private lastEmittedUtterance = "";
  private lastPending = "";
  private paused = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnecting = false;
  private utteranceSamples: number[] = [];
  private currentSampleRate: number;
  private stopped = false;

  constructor(private readonly options: AuraLiveVoiceOptions) {
    this.currentSampleRate = options.sampleRate;
  }

  private createTranscriber(): AuraLiveTranscriber {
    return new AuraLiveTranscriber({
      language: this.options.language ?? "pt",
      onText: (text) => this.handleText(text),
      onClose: () => this.handleClose(),
      onError: (error) => this.options.onError?.(error),
    });
  }

  /** Gates microphone forwarding (e.g. while Aura TTS is speaking). */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** Opens the streaming transcription session. */
  async start(): Promise<boolean> {
    const transcriber = this.createTranscriber();

    try {
      await transcriber.connect();
    } catch (error) {
      this.options.onError?.(
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }

    if (this.stopped) {
      transcriber.close();
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
    if (this.stopped || this.paused || !this.transcriber) return;
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.transcriber?.close();
    this.transcriber = null;

    this.flushUtterance();
    await this.analyzeTone();
  }

  private handleClose(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.flushUtterance();
    if (this.stopped || this.reconnecting) return;

    this.transcriber = null;
    this.serverText = "";
    this.committedText = "";
    this.lastEmittedUtterance = "";
    this.lastPending = "";
    this.reconnecting = true;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) {
        this.reconnecting = false;
        return;
      }
      const next = this.createTranscriber();
      void next
        .connect()
        .then(() => {
          if (this.stopped) {
            next.close();
            return;
          }
          this.transcriber = next;
        })
        .catch((error) => {
          if (!this.stopped) {
            this.options.onError?.(
              error instanceof Error ? error : new Error(String(error))
            );
          }
        })
        .finally(() => {
          this.reconnecting = false;
        });
    }, 350);
  }

  private handleText(text: string): void {
    if (this.stopped) return;

    this.serverText = text;
    const pending = extractNextUtterance(
      this.committedText,
      text,
      this.lastEmittedUtterance
    );
    if (!pending) return;

    if (pending !== this.lastPending) {
      this.lastPending = pending;
      this.options.onInterim?.(pending);
    }

    // The user paused: the utterance is complete.
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      this.flushUtterance();
    }, UTTERANCE_SILENCE_MS);
  }

  private flushUtterance(): void {
    const pending = extractNextUtterance(
      this.committedText,
      this.serverText,
      this.lastEmittedUtterance
    );
    if (!pending) return;

    this.committedText = collapseRepeatedPhrases(
      normalizeTranscriptText(this.serverText)
    );
    this.lastEmittedUtterance = pending;
    this.lastPending = "";
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
