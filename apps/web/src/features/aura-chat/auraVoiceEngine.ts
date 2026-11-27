import { cleanTextForSpeech } from "./auraThoughtParser";

export interface AuraVoiceSettings {
  /**
   * Which engine speaks the replies.
   * - `neural`: the local Kokoro service (realistic, offline, pt-BR + English)
   * - `browser`: the OS `SpeechSynthesis` fallback
   */
  engine: "neural" | "browser";
  /** Kokoro voice id used by the neural engine, e.g. `pf_dora`. */
  serviceVoice: string;
  /** Browser voice URI used by the `browser` engine. */
  selectedVoiceURI: string;
  speed: number;
  pitch: number;
  autoSpeak: boolean;
}

const STORAGE_KEY = "auradesk_voice_settings";

export const DEFAULT_VOICE_SETTINGS: AuraVoiceSettings = {
  engine: "neural",
  serviceVoice: "pf_dora",
  selectedVoiceURI: "",
  speed: 1.0,
  pitch: 1.0,
  autoSpeak: true,
};

export function loadVoiceSettings(): AuraVoiceSettings {
  if (typeof window === "undefined" || !window.localStorage) {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AuraVoiceSettings>;
    return {
      engine: parsed.engine === "browser" ? "browser" : "neural",
      serviceVoice:
        typeof parsed.serviceVoice === "string" && parsed.serviceVoice.length > 0
          ? parsed.serviceVoice
          : DEFAULT_VOICE_SETTINGS.serviceVoice,
      selectedVoiceURI: typeof parsed.selectedVoiceURI === "string" ? parsed.selectedVoiceURI : "",
      speed: typeof parsed.speed === "number" && parsed.speed >= 0.5 && parsed.speed <= 2.0 ? parsed.speed : 1.0,
      pitch: typeof parsed.pitch === "number" && parsed.pitch >= 0.5 && parsed.pitch <= 1.5 ? parsed.pitch : 1.0,
      autoSpeak: typeof parsed.autoSpeak === "boolean" ? parsed.autoSpeak : true,
    };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveVoiceSettings(settings: AuraVoiceSettings): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage write errors
  }
}

export interface DetectedVoice {
  name: string;
  lang: string;
  voiceURI: string;
  isPtBr: boolean;
  default: boolean;
}

/**
 * Lists available SpeechSynthesis voices, placing Brazilian Portuguese (pt-BR)
 * voices first, followed by general Portuguese and other system voices.
 */
export function getAvailableAuraVoices(): DetectedVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return [];
  }

  const rawVoices = window.speechSynthesis.getVoices();
  const list: DetectedVoice[] = rawVoices.map((v) => {
    const langLower = v.lang.toLowerCase();
    const nameLower = v.name.toLowerCase();
    const isPtBr =
      langLower.includes("pt-br") ||
      langLower === "pt_br" ||
      nameLower.includes("brazil") ||
      nameLower.includes("brasil");
    return {
      name: v.name,
      lang: v.lang,
      voiceURI: v.voiceURI,
      isPtBr,
      default: v.default,
    };
  });

  // Sort so pt-BR voices are prioritized at the top
  list.sort((a, b) => {
    if (a.isPtBr && !b.isPtBr) return -1;
    if (!a.isPtBr && b.isPtBr) return 1;
    return a.name.localeCompare(b.name);
  });

  return list;
}

/**
 * Speaks the given text using SpeechSynthesis, respecting Brazilian Portuguese
 * language preferences, custom voice selection, and speech rate.
 */
export function speakAuraUtterance(
  text: string,
  settings: AuraVoiceSettings,
  onStart?: () => void,
  onEnd?: () => void,
  onError?: () => void,
  preferredLang = "pt-BR"
): boolean {
  if (
    typeof window === "undefined" ||
    !("speechSynthesis" in window) ||
    typeof SpeechSynthesisUtterance === "undefined"
  ) {
    return false;
  }

  const cleaned = cleanTextForSpeech(text);
  if (!cleaned) return false;

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.rate = settings.speed;
    utterance.pitch = settings.pitch;

    // Detect and assign voice
    const voices = window.speechSynthesis.getVoices();
    const langPrefix = preferredLang.toLowerCase().split("-")[0] || "pt";
    let targetVoice: SpeechSynthesisVoice | undefined;

    if (settings.selectedVoiceURI) {
      targetVoice = voices.find((v) => v.voiceURI === settings.selectedVoiceURI);
    }

    if (!targetVoice) {
      if (langPrefix === "pt") {
        targetVoice = voices.find(
          (v) =>
            v.lang.toLowerCase().includes("pt-br") ||
            v.name.toLowerCase().includes("brazil") ||
            v.name.toLowerCase().includes("brasil")
        );
      } else {
        targetVoice = voices.find(
          (v) => v.lang.toLowerCase() === preferredLang.toLowerCase()
        );
      }
    }

    if (!targetVoice) {
      targetVoice = voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
    }

    if (targetVoice) {
      utterance.voice = targetVoice;
      utterance.lang = targetVoice.lang;
    } else {
      utterance.lang = preferredLang;
    }

    utterance.onstart = () => {
      onStart?.();
    };

    utterance.onend = () => {
      onEnd?.();
    };

    utterance.onerror = () => {
      onError?.();
    };

    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    onError?.();
    return false;
  }
}

export function stopAuraSpeech(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore cancellation errors
    }
  }
}
