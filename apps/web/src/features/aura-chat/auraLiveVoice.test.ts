import { describe, expect, it, vi } from "vitest";

const { transcriberMock } = vi.hoisted(() => {
  const instance = {
    isConnected: true,
    connect: vi.fn(async () => {}),
    send: vi.fn(),
    close: vi.fn(),
  };
  let onText: ((text: string) => void) | undefined;
  let onClose: (() => void) | undefined;

  const constructor = vi.fn((options: { onText?: (t: string) => void; onClose?: () => void }) => {
    onText = options.onText;
    onClose = options.onClose;
    return instance;
  });

  return {
    transcriberMock: {
      constructor,
      instance,
      emit: (text: string) => onText?.(text),
      emitClose: () => onClose?.(),
    },
  };
});

vi.mock("./auraSpeechToText", () => ({
  AuraLiveTranscriber: transcriberMock.constructor,
}));

import {
  AuraLiveVoiceSession,
  collapseRepeatedPhrases,
  extractNextUtterance,
  normalizeTranscriptText,
} from "./auraLiveVoice";

describe("AuraLiveVoiceSession", () => {
  it("cuts a new utterance out of the growing transcript", async () => {
    const finals: string[] = [];
    const interims: string[] = [];

    const session = new AuraLiveVoiceSession({
      language: "pt",
      sampleRate: 16000,
      onFinal: (text) => finals.push(text),
      onInterim: (text) => interims.push(text),
    });

    await session.start();

    // The service reports everything it has heard so far.
    transcriberMock.emit("Olá, eu");
    transcriberMock.emit("Olá, eu sou a");
    transcriberMock.emit("Olá, eu sou a Aura");

    expect(interims.length).toBeGreaterThan(0);
    expect(finals).toHaveLength(0);
  });

  it("delivers the pending text when the session closes", async () => {
    const finals: string[] = [];
    const session = new AuraLiveVoiceSession({
      language: "pt",
      sampleRate: 16000,
      onFinal: (text) => finals.push(text),
    });

    await session.start();
    transcriberMock.emit("Bom dia");
    transcriberMock.emitClose();

    expect(finals).toEqual(["Bom dia"]);
  });

  it("forwards the microphone samples to the transcriber", async () => {
    const session = new AuraLiveVoiceSession({ language: "pt", sampleRate: 48000 });
    await session.start();

    const samples = new Float32Array([0.1, 0.2, 0.3]);
    session.push(samples, 48000);

    expect(transcriberMock.instance.send).toHaveBeenCalledWith(samples, 48000);
  });

  it("reports that the session could not start", async () => {
    transcriberMock.instance.connect.mockRejectedValueOnce(
      new Error("connection refused")
    );
    const errors: Error[] = [];

    const session = new AuraLiveVoiceSession({
      language: "pt",
      sampleRate: 16000,
      onError: (error) => errors.push(error),
    });

    const started = await session.start();

    expect(started).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it("normalizes double spaces and stray punctuation spaces", () => {
    expect(normalizeTranscriptText("  Alô ,  te   esperando !  ")).toBe(
      "Alô, te esperando!"
    );
    expect(collapseRepeatedPhrases("Alô, te esperando! Alô, te esperando!")).toBe(
      "Alô, te esperando!"
    );
  });

  it("deduplicates repeated Whisper phrases and extracts only new words after flush", async () => {
    vi.useFakeTimers();
    try {
      const finals: string[] = [];
      const interims: string[] = [];

      const session = new AuraLiveVoiceSession({
        language: "pt",
        sampleRate: 16000,
        onFinal: (text) => finals.push(text),
        onInterim: (text) => interims.push(text),
      });

      await session.start();
      transcriberMock.emit("Alô,  te");
      vi.advanceTimersByTime(1850);
      expect(finals).toEqual(["Alô, te"]);

      transcriberMock.emit("Alô,  te  esperando!  Alô,  te  esperando!");
      expect(interims[interims.length - 1]).toBe("esperando!");
      vi.advanceTimersByTime(1850);
      expect(finals).toEqual(["Alô, te", "esperando!"]);

      // Re-emitting exact same finalized utterance should be ignored.
      transcriberMock.emit("esperando!");
      vi.advanceTimersByTime(1850);
      expect(finals).toEqual(["Alô, te", "esperando!"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("strips rolling-window overlap from committed text", () => {
    expect(
      extractNextUtterance("Bom dia Aura tudo bem", "tudo bem preciso de ajuda")
    ).toBe("preciso de ajuda");
  });

  it("gates microphone sample forwarding while paused for TTS playback", async () => {
    transcriberMock.instance.send.mockClear();
    const session = new AuraLiveVoiceSession({ language: "pt", sampleRate: 16000 });
    await session.start();

    const samples = new Float32Array([0.1, 0.2]);
    session.setPaused(true);
    session.push(samples, 16000);
    expect(transcriberMock.instance.send).not.toHaveBeenCalled();

    session.setPaused(false);
    session.push(samples, 16000);
    expect(transcriberMock.instance.send).toHaveBeenCalledTimes(1);
  });
});
