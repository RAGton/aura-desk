import { describe, expect, it, vi } from "vitest";
import { extractSentence, stripSpeechMarkup, AuraSpeechQueue } from "./auraSpeechQueue";
import type { AuraAudioPlayer } from "./auraAudioPlayer";

const { synthesizeMock } = vi.hoisted(() => ({
  synthesizeMock: vi.fn(
    async (_text: string, _opts: unknown, onChunk?: (chunk: Uint8Array) => void) => {
      onChunk?.(new Uint8Array([1, 2]));
      return 2;
    }
  ),
}));

vi.mock("./auraVoiceService", () => ({
  synthesizeAuraPcm: synthesizeMock,
}));

describe("extractSentence", () => {
  it("extracts a complete sentence and keeps the rest", () => {
    const result = extractSentence("Olá! Como você está?");
    expect(result?.sentence).toBe("Olá!");
    expect(result?.rest).toBe("Como você está?");
  });

  it("waits for a terminator", () => {
    expect(extractSentence("Sem ponto final ainda")).toBeNull();
  });

  it("does not split on an abbreviation inside a word", () => {
    // "Dr. Silva" — the terminator is followed by a letter, not whitespace.
    expect(extractSentence("Dr. Silva")).toBeNull();
  });

  it("breaks a very long run without punctuation", () => {
    const long = "a".repeat(300);
    const result = extractSentence(long);
    expect(result).not.toBeNull();
    expect(result!.sentence.length).toBeGreaterThan(0);
    expect(result!.rest.length).toBeGreaterThan(0);
  });

  it("prefers a clause boundary when breaking a long sentence", () => {
    const long = `${"palavra ".repeat(20)}e ${"outra ".repeat(20)}fim`;
    const result = extractSentence(long);
    expect(result).not.toBeNull();
    expect(result!.sentence.length).toBeLessThan(240);
  });
});

describe("stripSpeechMarkup", () => {
  it("removes code fences, links and emphasis", () => {
    const raw = "Veja `código` e [a documentação](https://exemplo.com) **forte**.";
    expect(stripSpeechMarkup(raw)).toBe("Veja código e a documentação forte.");
  });

  it("collapses whitespace and newlines", () => {
    expect(stripSpeechMarkup("linha um\n\nlinha   dois")).toBe("linha um linha dois");
  });

  it("drops image markdown entirely", () => {
    expect(stripSpeechMarkup("antes ![alt](img.png) depois")).toBe("antes depois");
  });
});

/** Minimal player double that records what it was asked to play. */
function createPlayerStub() {
  const played: Uint8Array[] = [];
  const player = {
    play: (chunk: Uint8Array) => {
      played.push(chunk);
    },
    stop: vi.fn(),
    reset: vi.fn(),
    resume: vi.fn(async () => {}),
    get isPlaying() {
      return false;
    },
  } as unknown as AuraAudioPlayer & { played: Uint8Array[] };
  (player as unknown as { played: Uint8Array[] }).played = played;
  return player;
}

describe("AuraSpeechQueue", () => {
  it("synthesizes complete sentences as soon as they arrive", async () => {
    const player = createPlayerStub();
    synthesizeMock.mockClear();

    const queue = new AuraSpeechQueue({
      voice: "pf_dora",
      speed: 1,
      player,
    });

    queue.push("Olá. Como vai?");
    await queue.flush();

    expect(synthesizeMock).toHaveBeenCalledTimes(2);
    expect((synthesizeMock.mock.calls[0] as unknown[])[0]).toBe("Olá.");
    expect((synthesizeMock.mock.calls[1] as unknown[])[0]).toBe("Como vai?");
    expect(player.played).toHaveLength(2);
  });

  it("stops and clears pending work", () => {
    const player = createPlayerStub();
    const queue = new AuraSpeechQueue({ voice: "pf_dora", speed: 1, player });

    queue.push("Uma frase. Outra frase.");
    queue.stop();

    expect(player.stop).toHaveBeenCalled();
  });
});
