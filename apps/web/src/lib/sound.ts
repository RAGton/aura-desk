export type NotificationChimeKind = "normal" | "urgent" | "success";

/**
 * Plays a short unobtrusive Web Audio chime in browser runtimes (when audio
 * hardware / AudioContext is permitted). Safe no-op in headless/test runs.
 */
export function playNotificationChime(kind: NotificationChimeKind = "normal"): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";

    const startFreq = kind === "urgent" ? 880 : kind === "success" ? 523.25 : 660;
    const endFreq = kind === "urgent" ? 1046.5 : kind === "success" ? 783.99 : 880;

    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.16);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.38);
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  } catch {
    // Web Audio unavailable in headless / restricted environments.
  }
}
