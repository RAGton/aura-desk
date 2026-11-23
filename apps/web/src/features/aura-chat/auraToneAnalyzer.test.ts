import { describe, expect, it } from "vitest";
import {
  analyzeAuraTone,
  describeTone,
  probabilitiesToDimensions,
  setAuraEmotionClassifier,
} from "./auraToneAnalyzer";

/** Builds a mono signal with a given fundamental frequency and duration. */
function buildTone(frequency: number, seconds: number, sampleRate = 16000, amplitude = 0.4) {
  const count = Math.floor(seconds * sampleRate);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return samples;
}

describe("analyzeAuraTone", () => {
  it("estimates the fundamental frequency of a synthetic tone", async () => {
    const analysis = await analyzeAuraTone(buildTone(150, 1), 16000);

    // Autocorrelation should land close to the generated frequency.
    expect(analysis.meanPitchHz).toBeGreaterThan(120);
    expect(analysis.meanPitchHz).toBeLessThan(180);
    expect(analysis.voicedRatio).toBeGreaterThan(0.8);
  });

  it("detects a higher pitch than a lower one", async () => {
    const low = await analyzeAuraTone(buildTone(110, 1), 16000);
    const high = await analyzeAuraTone(buildTone(220, 1), 16000);

    expect(high.meanPitchHz).toBeGreaterThan(low.meanPitchHz);
  });

  it("reports silence for an empty buffer", async () => {
    const analysis = await analyzeAuraTone(new Float32Array(0), 16000);

    expect(analysis.meanPitchHz).toBe(0);
    expect(analysis.voicedRatio).toBe(0);
    expect(analysis.speechRate).toBe(0);
  });

  it("measures the loudness of the signal", async () => {
    const quiet = await analyzeAuraTone(buildTone(150, 1, 16000, 0.05), 16000);
    const loud = await analyzeAuraTone(buildTone(150, 1, 16000, 0.6), 16000);

    expect(loud.meanLoudnessDb).toBeGreaterThan(quiet.meanLoudnessDb);
  });

  it("folds the model probabilities into valence and arousal", async () => {
    setAuraEmotionClassifier(async () => ({
      probabilities: { happy: 0.8, calm: 0.1, sad: 0.05, angry: 0.05 },
    }));

    const analysis = await analyzeAuraTone(buildTone(150, 1), 16000);

    expect(analysis.modelBased).toBe(true);
    expect(analysis.valence).toBeGreaterThan(0);
    expect(analysis.arousal).toBeGreaterThan(0);

    setAuraEmotionClassifier(null);
  });

  it("falls back to the prosody reading when the classifier fails", async () => {
    setAuraEmotionClassifier(async () => {
      throw new Error("model unavailable");
    });

    const analysis = await analyzeAuraTone(buildTone(150, 1), 16000);

    expect(analysis.modelBased).toBe(false);
    expect(Number.isFinite(analysis.valence)).toBe(true);
    expect(Number.isFinite(analysis.arousal)).toBe(true);

    setAuraEmotionClassifier(null);
  });
});

describe("probabilitiesToDimensions", () => {
  it("maps a happy distribution to positive valence and arousal", () => {
    const dims = probabilitiesToDimensions({
      happy: 0.7,
      calm: 0.2,
      sad: 0.05,
      angry: 0.05,
    });

    expect(dims.valence).toBeGreaterThan(0);
    expect(dims.arousal).toBeGreaterThan(0);
  });

  it("maps an angry distribution to negative valence and high arousal", () => {
    const dims = probabilitiesToDimensions({
      angry: 0.8,
      sad: 0.1,
      happy: 0.05,
      calm: 0.05,
    });

    expect(dims.valence).toBeLessThan(0);
    expect(dims.arousal).toBeGreaterThan(0);
  });

  it("returns neutral values for an empty distribution", () => {
    expect(probabilitiesToDimensions({})).toEqual({ valence: 0, arousal: 0 });
  });
});

describe("describeTone", () => {
  it("labels the four quadrants", () => {
    expect(describeTone(0.5, 0.5)).toBe("animado");
    expect(describeTone(-0.5, 0.5)).toBe("tenso");
    expect(describeTone(0.5, -0.5)).toBe("tranquilo");
    expect(describeTone(-0.5, -0.5)).toBe("pensativo");
    expect(describeTone(0, 0)).toBe("neutro");
  });
});
