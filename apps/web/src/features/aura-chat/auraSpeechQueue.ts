/**
 * Real-time speech queue for Aura.
 *
 * The assistant reply arrives as a token stream. To speak it while it is
 * still being generated, the stream is split into sentences and each
 * sentence is synthesized as soon as it is complete. Playback is scheduled
 * gaplessly, so the user starts hearing the reply within a sentence of it
 * being written.
 */

import type { AuraAudioPlayer } from "./auraAudioPlayer";
import { synthesizeAuraPcm, type AuraSynthesisOptions } from "./auraVoiceService";

/** Terminators that end a spoken sentence. */
const SENTENCE_END = /[.!?…]/;
/** Hard limit: a sentence longer than this is spoken in pieces. */
const MAX_SENTENCE_LENGTH = 240;
/** Minimum characters before a terminator is accepted as a sentence end. */
const MIN_SENTENCE_LENGTH = 2;

/**
 * Abbreviations whose trailing dot is not a sentence end. Without this the
 * stream would be split into "Dr." + "Silva", producing an audible pause in
 * the middle of a title.
 */
const NON_TERMINATING_ABBREVIATIONS = new Set([
  "dr",
  "dra",
  "sr",
  "sra",
  "srta",
  "prof",
  "profa",
  "ex",
  "vs",
  "etc",
  "p.ex",
  "q.b.",
  "cf",
  "av",
  "jr",
  "sr.",
]);

/** True when the word ending at `dotIndex` is a known abbreviation. */
function endsWithAbbreviation(text: string, dotIndex: number): boolean {
  const before = text.slice(0, dotIndex);
  const match = before.match(/([\w.]+)$/);
  if (!match) return false;
  return NON_TERMINATING_ABBREVIATIONS.has(match[1].toLowerCase());
}

/**
 * Extracts the first complete sentence from `buffer`.
 * Returns `null` when the buffer does not yet hold a complete sentence.
 */
export function extractSentence(buffer: string): { sentence: string; rest: string } | null {
  const trimmed = buffer.trimStart();
  if (!trimmed) return null;

  // A very long run without punctuation is spoken in pieces so the user
  // does not wait for a full stop that may never come.
  if (trimmed.length >= MAX_SENTENCE_LENGTH) {
    // Try to break on a clause boundary first.
    const clause = trimmed.slice(0, MAX_SENTENCE_LENGTH);
    const breakAt = Math.max(
      clause.lastIndexOf(", "),
      clause.lastIndexOf("; "),
      clause.lastIndexOf(": "),
      clause.lastIndexOf(" — ")
    );
    if (breakAt > MIN_SENTENCE_LENGTH) {
      return {
        sentence: clause.slice(0, breakAt).trim(),
        rest: trimmed.slice(breakAt).trimStart(),
      };
    }
    return {
      sentence: clause.trim(),
      rest: trimmed.slice(MAX_SENTENCE_LENGTH).trimStart(),
    };
  }

  // Find the first terminator that really ends a sentence.
  let match: RegExpExecArray | null = null;
  let searchFrom = 0;
  for (;;) {
    const candidate = SENTENCE_END.exec(trimmed.slice(searchFrom));
    if (!candidate) break;
    const index = searchFrom + candidate.index;
    const end = index + candidate[0].length;
    const next = trimmed[end];

    const followedByWord = next !== undefined && !/[\s"'”’)\]]/.test(next);
    const abbreviation = candidate[0] === "." && endsWithAbbreviation(trimmed, index);

    if (!followedByWord && !abbreviation) {
      match = candidate;
      match.index = index;
      break;
    }
    searchFrom = end;
  }

  if (!match) return null;

  const end = match.index + match[0].length;
  const sentence = trimmed.slice(0, end).trim();
  if (sentence.length < MIN_SENTENCE_LENGTH) return null;

  return { sentence, rest: trimmed.slice(end).trimStart() };
}

/** Removes markup the speech synthesizer should not pronounce. */
export function stripSpeechMarkup(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>~]/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type AuraSpeechQueueState = "idle" | "speaking";

export interface AuraSpeechQueueOptions extends Omit<AuraSynthesisOptions, "voice"> {
  voice: string;
  player: AuraAudioPlayer;
  /** Called when the queue transitions between idle and speaking. */
  onStateChange?: (state: AuraSpeechQueueState) => void;
  /** Called when a synthesis request fails. */
  onError?: (error: Error) => void;
  /** Base URL of the voice service. */
  baseUrl?: string;
}

/**
 * Buffers streamed text, synthesizes complete sentences one at a time and
 * plays them without gaps.
 */
export class AuraSpeechQueue {
  private buffer = "";
  private pending: string[] = [];
  private busy = false;
  private stopped = false;
  private state: AuraSpeechQueueState = "idle";

  constructor(private readonly options: AuraSpeechQueueOptions) {}

  get isSpeaking(): boolean {
    return this.state === "speaking";
  }

  private setState(next: AuraSpeechQueueState): void {
    if (this.state === next) return;
    this.state = next;
    this.options.onStateChange?.(next);
  }

  /** Feeds streamed text into the queue. */
  push(text: string): void {
    if (this.stopped || !text) return;
    this.buffer += text;

    for (;;) {
      const found = extractSentence(this.buffer);
      if (!found) break;
      this.buffer = found.rest;
      const clean = stripSpeechMarkup(found.sentence);
      if (clean) this.pending.push(clean);
    }

    void this.drain();
  }

  /** Speaks whatever is left in the buffer (end of the assistant reply). */
  flush(): Promise<void> {
    const rest = stripSpeechMarkup(this.buffer);
    this.buffer = "";
    if (rest) this.pending.push(rest);
    return this.drain();
  }

  /** Drops everything pending and stops playback. */
  stop(): void {
    this.stopped = true;
    this.buffer = "";
    this.pending = [];
    this.options.player.stop();
    this.setState("idle");
  }

  /** Resets the queue so it can be reused for the next reply. */
  reset(): void {
    this.stopped = false;
    this.buffer = "";
    this.pending = [];
    this.options.player.reset();
    this.setState("idle");
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.pending.length > 0 && !this.stopped) {
        const sentence = this.pending.shift();
        if (!sentence) continue;
        this.setState("speaking");
        try {
          await synthesizeAuraPcm(
            sentence,
            {
              voice: this.options.voice,
              speed: this.options.speed,
              langCode: this.options.langCode,
              baseUrl: this.options.baseUrl,
            },
            (chunk) => this.options.player.play(chunk)
          );
        } catch (error) {
          this.options.onError?.(
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }
    } finally {
      this.busy = false;
      if (this.pending.length === 0 && !this.options.player.isPlaying) {
        this.setState("idle");
      }
    }
  }
}
