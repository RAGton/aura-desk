/**
 * Voice tone analysis ("tom e humor") for Aura.
 *
 * Two layers, both running locally and offline:
 *
 * 1. **Prosody** (always available, no model): pitch (F0), loudness, speech
 *    rate and pause structure computed directly from the captured PCM.
 *    These are language-independent acoustic correlates of how someone
 *    sounds, so they work on Brazilian Portuguese as well as English.
 *
 * 2. **Valence / arousal** (optional): a 7-class speech-emotion classifier
 *    (`onnx-community/wav2vec2-emotion-recognition-ONNX`, MIT) can be
 *    attached through {@link setAuraEmotionClassifier}. The class
 *    probabilities are folded into a valence and an arousal score in the
 *    [-1, 1] range.
 *
 * The classifier is deliberately optional: the tone reading degrades
 * gracefully to prosody-only instead of failing when the model is missing.
 */

/** A single analysed chunk of speech. */
export interface AuraToneAnalysis {
  /** Mean fundamental frequency in Hz, over voiced frames. */
  meanPitchHz: number;
  /** Standard deviation of the fundamental frequency, in Hz. */
  pitchStdDevHz: number;
  /** Peak-to-peak pitch excursion, in semitones. */
  pitchRangeSemitones: number;
  /** Mean loudness in dBFS over voiced frames. */
  meanLoudnessDb: number;
  /** Loudness variability in dB. */
  loudnessStdDevDb: number;
  /** Voiced frames per second — a proxy for syllables per second. */
  speechRate: number;
  /** Total time spent in pauses longer than 200 ms, in seconds. */
  pauseSeconds: number;
  /** Share of the analysed window that is speech, in [0, 1]. */
  voicedRatio: number;
  /** Arousal estimate in [-1, 1]. */
  arousal: number;
  /** Valence estimate in [-1, 1]. */
  valence: number;
  /** Short human-readable label for the current tone. */
  label: string;
  /** True when a model contributed to valence/arousal. */
  modelBased: boolean;
}

/** Result returned by a pluggable emotion classifier. */
export interface AuraEmotionProbabilities {
  /** Class name to probability, e.g. `{ happy: 0.42, calm: 0.31 }`. */
  probabilities: Record<string, number>;
}

/** Pluggable emotion classifier. */
export type AuraEmotionClassifier = (
  samples: Float32Array,
  sampleRate: number
) => Promise<AuraEmotionProbabilities | null>;

let emotionClassifier: AuraEmotionClassifier | null = null;

/**
 * Registers the emotion classifier used to refine valence and arousal.
 * Pass `null` to remove it.
 */
export function setAuraEmotionClassifier(
  classifier: AuraEmotionClassifier | null
): void {
  emotionClassifier = classifier;
}

/** True when a model-based classifier is attached. */
export function hasAuraEmotionClassifier(): boolean {
  return emotionClassifier !== null;
}

/** Analysis window length in seconds. */
const WINDOW_SECONDS = 0.04;
/** Hop between analysis frames in seconds. */
const HOP_SECONDS = 0.01;
/** Pitch search range in Hz (typical adult speaking range). */
const MIN_F0_HZ = 65;
const MAX_F0_HZ = 400;
/** Normalized autocorrelation above which a frame counts as voiced. */
const VOICING_THRESHOLD = 0.32;
/**
 * A local maximum is accepted when it reaches this fraction of the global
 * maximum. Keeps the detector from locking onto a subharmonic.
 */
const PEAK_ACCEPTANCE_RATIO = 0.9;
/** Frames quieter than this (dBFS) are treated as silence. */
const SILENCE_DB = -45;
/** A non-voiced run longer than this counts as a pause. */
const PAUSE_SECONDS = 0.2;

function rmsDb(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  let count = 0;
  for (let i = start; i < end; i += 1) {
    const v = samples[i];
    sum += v * v;
    count += 1;
  }
  if (count === 0) return -120;
  const rms = Math.sqrt(sum / count);
  return 20 * Math.log10(Math.max(rms, 1e-7));
}

/**
 * Estimates the fundamental frequency of one frame with normalized
 * autocorrelation. Returns `0` for unvoiced frames.
 *
 * The correlation function peaks at every multiple of the true period, so
 * picking the global maximum would report a subharmonic (220 Hz read as
 * 73 Hz). Instead the first local maximum that is close enough to the
 * global one is used, and a parabolic interpolation refines it to
 * sub-sample precision.
 */
function estimateF0(samples: Float32Array, start: number, end: number, sampleRate: number): number {
  const size = end - start;
  if (size < 64) return 0;

  const minLag = Math.floor(sampleRate / MAX_F0_HZ);
  const maxLag = Math.min(Math.floor(sampleRate / MIN_F0_HZ), size - 1);
  if (maxLag <= minLag) return 0;

  let energy = 0;
  for (let i = start; i < end; i += 1) energy += samples[i] * samples[i];
  if (energy <= 1e-9) return 0;

  const correlations = new Float32Array(maxLag + 2);
  let globalMax = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < size - lag; i += 1) {
      const a = samples[start + i];
      const b = samples[start + i + lag];
      correlation += a * b;
      normA += a * a;
      normB += b * b;
    }
    const denominator = Math.sqrt(normA * normB);
    const normalized = denominator > 1e-9 ? correlation / denominator : 0;
    correlations[lag] = normalized;
    if (normalized > globalMax) globalMax = normalized;
  }

  if (globalMax < VOICING_THRESHOLD) return 0;

  // Accept the first local maximum that is close to the global one.
  const threshold = globalMax * PEAK_ACCEPTANCE_RATIO;
  let chosenLag = 0;
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    const value = correlations[lag];
    if (
      value >= threshold &&
      value > correlations[lag - 1] &&
      value >= correlations[lag + 1]
    ) {
      chosenLag = lag;
      break;
    }
  }
  if (chosenLag === 0) return 0;

  // Parabolic interpolation around the peak for sub-sample accuracy.
  const left = correlations[chosenLag - 1];
  const middle = correlations[chosenLag];
  const right = correlations[chosenLag + 1];
  const denominator = left - 2 * middle + right;
  let refinedLag = chosenLag;
  if (Math.abs(denominator) > 1e-9) {
    const shift = (0.5 * (left - right)) / denominator;
    if (Math.abs(shift) < 1) refinedLag = chosenLag + shift;
  }

  const frequency = sampleRate / refinedLag;
  if (frequency < MIN_F0_HZ || frequency > MAX_F0_HZ) return 0;
  return frequency;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function standardDeviation(values: number[], average: number): number {
  if (values.length === 0) return 0;
  const variance =
    values.reduce((acc, v) => acc + (v - average) * (v - average), 0) / values.length;
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Converts a frequency ratio to semitones. */
function ratioToSemitones(ratio: number): number {
  return 12 * Math.log2(Math.max(ratio, 1e-6));
}

/**
 * Folds 7-class emotion probabilities into valence and arousal.
 *
 * valence: happy / calm are positive, sad / angry / disgust / fearful are
 * negative.
 * arousal: angry / surprised / fearful are high, calm / sad are low.
 */
export function probabilitiesToDimensions(
  probabilities: Record<string, number>
): { valence: number; arousal: number } {
  const get = (name: string) => probabilities[name] ?? 0;
  const total = Object.values(probabilities).reduce((a, b) => a + b, 0);
  if (total <= 0) return { valence: 0, arousal: 0 };

  const valenceRaw =
    get("happy") +
    get("calm") * 0.6 -
    get("sad") -
    get("angry") -
    get("disgust") -
    get("fearful") * 0.8;
  const arousalRaw =
    get("angry") +
    get("surprised") +
    get("fearful") * 0.8 +
    get("happy") * 0.5 -
    get("calm") -
    get("sad") * 0.6;

  return {
    valence: clamp(valenceRaw / total, -1, 1),
    arousal: clamp(arousalRaw / total, -1, 1),
  };
}

/**
 * Derives a short label from the arousal/valence pair.
 */
export function describeTone(valence: number, arousal: number): string {
  const excited = arousal > 0.25;
  const calm = arousal < -0.2;
  const positive = valence > 0.2;
  const negative = valence < -0.2;

  if (excited && positive) return "animado";
  if (excited && negative) return "tenso";
  if (calm && positive) return "tranquilo";
  if (calm && negative) return "pensativo";
  if (positive) return "positivo";
  if (negative) return "sério";
  return "neutro";
}

/**
 * Analyses a block of mono PCM.
 *
 * `samples` must be the raw microphone signal at `sampleRate`. When a model
 * classifier is registered it is called with the same buffer.
 */
export async function analyzeAuraTone(
  samples: Float32Array,
  sampleRate: number
): Promise<AuraToneAnalysis> {
  const windowSize = Math.max(1, Math.floor(sampleRate * WINDOW_SECONDS));
  const hopSize = Math.max(1, Math.floor(sampleRate * HOP_SECONDS));

  const pitches: number[] = [];
  const loudness: number[] = [];
  let voicedFrames = 0;
  let totalFrames = 0;
  let silenceRun = 0;
  let pauseSeconds = 0;

  for (let start = 0; start + windowSize <= samples.length; start += hopSize) {
    const end = start + windowSize;
    totalFrames += 1;

    const db = rmsDb(samples, start, end);
    const f0 = estimateF0(samples, start, end, sampleRate);

    if (db < SILENCE_DB) {
      silenceRun += HOP_SECONDS;
      if (silenceRun >= PAUSE_SECONDS) {
        // Count the pause only once, when it ends.
        pauseSeconds += PAUSE_SECONDS;
        silenceRun -= PAUSE_SECONDS;
      }
      continue;
    }

    silenceRun = 0;
    loudness.push(db);
    if (f0 > 0) {
      voicedFrames += 1;
      pitches.push(f0);
    }
  }

  const duration = samples.length / sampleRate;
  const meanPitch = mean(pitches);
  const pitchStdDev = standardDeviation(pitches, meanPitch);
  const meanLoudness = mean(loudness);
  const loudnessStdDev = standardDeviation(loudness, meanLoudness);
  const speechRate = duration > 0 ? voicedFrames / duration : 0;
  const voicedRatio = totalFrames > 0 ? voicedFrames / totalFrames : 0;

  // Prosody-only dimensions. Loudness and pitch variability raise arousal;
  // a wide pitch range together with a brisk rate leans positive, a flat
  // and slow delivery leans negative.
  const prosodyArousal = clamp(
    (pitchStdDev / 60) * 0.5 + (loudnessStdDev / 12) * 0.3 + (speechRate / 5) * 0.4 - 0.5,
    -1,
    1
  );
  const prosodyValence = clamp(
    (speechRate / 5 - 0.5) * 0.6 +
      (pitches.length > 1 ? ratioToSemitones(Math.max(pitches[0], 1) / Math.max(meanPitch, 1)) : 0) * 0.2,
    -1,
    1
  );

  let valence = prosodyValence;
  let arousal = prosodyArousal;
  let modelBased = false;

  if (emotionClassifier) {
    try {
      const result = await emotionClassifier(samples, sampleRate);
      if (result && Object.keys(result.probabilities).length > 0) {
        const dims = probabilitiesToDimensions(result.probabilities);
        // Blend the model with the prosody: the model is stronger evidence
        // for valence, prosody is stronger for arousal on short samples.
        valence = clamp(dims.valence * 0.75 + prosodyValence * 0.25, -1, 1);
        arousal = clamp(dims.arousal * 0.65 + prosodyArousal * 0.35, -1, 1);
        modelBased = true;
      }
    } catch {
      // Keep the prosody-only reading when the model fails.
    }
  }

  const minPitch = pitches.length > 0 ? Math.min(...pitches) : 0;
  const maxPitch = pitches.length > 0 ? Math.max(...pitches) : 0;

  return {
    meanPitchHz: meanPitch,
    pitchStdDevHz: pitchStdDev,
    pitchRangeSemitones:
      minPitch > 0 && maxPitch > 0 ? ratioToSemitones(maxPitch / minPitch) : 0,
    meanLoudnessDb: meanLoudness,
    loudnessStdDevDb: loudnessStdDev,
    speechRate,
    pauseSeconds,
    voicedRatio,
    arousal,
    valence,
    label: describeTone(valence, arousal),
    modelBased,
  };
}
