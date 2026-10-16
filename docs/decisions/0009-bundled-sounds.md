# ADR-009: Sounds bundled as WAV, not synthesized

**Status:** Accepted
**Date:** 2026-10-16

## Context

Reminders and routines need audible alerts. Options:

- Bundle audio files (WAV/MP3/OGG) in the repo.
- Synthesize tones at runtime (sine waves, etc.) with a Rust audio
  library.
- Use the OS system bell (no asset, but inconsistent UX).

## Decision

Bundle **three short WAV files** in `apps/web/public/sounds/`:

- `alert-info.wav` (~0.5s, gentle ping)
- `alert-normal.wav` (~1.0s, two-tone)
- `alert-urgent.wav` (~1.5s, persistent three-tone)

Format: PCM 16-bit 44.1 kHz mono. The Rust backend uses `rodio` to
play them; the frontend can also play them via the Web Audio API
(redundancy for Tauri-WebView cases).

## Consequences

Positive:
- Predictable, design-controlled sound.
- No CPU cost for synthesis.
- Sounds work offline.
- We can swap files later without code changes (just replace the
  assets).

Negative:
- ~50–200 KB of binary bloat. Acceptable.
- Audio assets need a place in the license declaration.
- Future sounds (custom user uploads) require an asset pipeline (YAGNI
  for MVP).
