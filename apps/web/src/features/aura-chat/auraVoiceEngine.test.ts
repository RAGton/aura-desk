import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_VOICE_SETTINGS,
  getAvailableAuraVoices,
  loadVoiceSettings,
  saveVoiceSettings,
  speakAuraUtterance,
  stopAuraSpeech,
} from "./auraVoiceEngine";

describe("auraVoiceEngine", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads and saves voice settings in localStorage", () => {
    expect(loadVoiceSettings()).toEqual(DEFAULT_VOICE_SETTINGS);

    const updated = {
      ...DEFAULT_VOICE_SETTINGS,
      speed: 1.2,
    };
    saveVoiceSettings(updated);

    expect(loadVoiceSettings().speed).toBe(1.2);
    expect(loadVoiceSettings().autoSpeak).toBe(true);
  });

  it("orders pt-BR voices first when enumerating voices", () => {
    const mockVoices = [
      { name: "Alex", lang: "en-US", voiceURI: "alex-uri", default: true },
      { name: "Luciana", lang: "pt-BR", voiceURI: "luciana-uri", default: false },
      { name: "Felipe (Brazil)", lang: "pt-BR", voiceURI: "felipe-uri", default: false },
    ];

    (window as unknown as { speechSynthesis: { getVoices: () => typeof mockVoices } }).speechSynthesis = {
      getVoices: () => mockVoices,
    };

    const list = getAvailableAuraVoices();
    expect(list[0].isPtBr).toBe(true);
    expect(list[1].isPtBr).toBe(true);
    expect(list[2].isPtBr).toBe(false);
  });

  it("speaks utterance and handles stop without crashing", () => {
    const cancelMock = vi.fn();
    const speakMock = vi.fn();

    (window as unknown as {
      speechSynthesis: {
        cancel: typeof cancelMock;
        speak: typeof speakMock;
        getVoices: () => unknown[];
      };
    }).speechSynthesis = {
      cancel: cancelMock,
      speak: speakMock,
      getVoices: () => [],
    };

    class MockUtterance {
      text: string;
      rate = 1;
      pitch = 1;
      lang = "pt-BR";
      constructor(text: string) {
        this.text = text;
      }
    }
    (window as unknown as { SpeechSynthesisUtterance: typeof MockUtterance }).SpeechSynthesisUtterance =
      MockUtterance;

    const started = speakAuraUtterance("Olá, mundo!", DEFAULT_VOICE_SETTINGS);
    expect(started).toBe(true);
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(speakMock).toHaveBeenCalledTimes(1);

    stopAuraSpeech();
    expect(cancelMock).toHaveBeenCalledTimes(2);
  });
});
