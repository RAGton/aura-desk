# ADR-006: In-process tokio scheduler, single-writer SQLite, `last_fired_at` in V001

**Status:** Accepted
**Date:** 2026-10-16
**Updated:** 2026-10-17

## Context

AuraDesk fires reminders and routines at specific times. We need a
mechanism that:

- Survives app restarts (a reminder for "3pm" should still fire after
  the app was closed at 2pm and reopened at 4pm).
- Works offline.
- Doesn't depend on systemd, cron, or Windows Task Scheduler (which have
  inconsistent UX across distros and versions).
- Is testable.

After the 2026-10-17 critical review we also need to support:

- Routine re-firing after the app was closed for days (no duplicate fires
  on restart).
- Suspend/resume recovery (Linux `WakeFromSleep`, Windows
  `PBT_APMRESUMEAUTOMATIC`).

## Decision

Use a **tokio task inside the Tauri process** that:

- Polls the DB every 5 seconds for `reminders WHERE status='pending'
  AND fire_at <= now()` and `routines WHERE enabled=1` whose next
  cron tick is due (or whose `kind='daily_planning'` and the configured
  time is reached).
- On restart, queries the same sets and dispatches any that are already
  due (recovery path). For routines, the last-fired mark is `last_fired_at`;
  fires with `now - last_fired_at < cron_interval` are skipped, preventing
  duplicate catch-up fires.
- Emits a Tauri event (`reminder:fired`, `routine:fired`) which the
  frontend listens to and renders the modal.
- Subscribes to `PrepareForSleep` / `WakeFromSleep` (Linux) and
  `PBT_APMRESUMEAUTOMATIC` (Windows) to replay due reminders on resume.

SQLite writes are serialized via `tokio::sync::Mutex<Connection>`. Reads
use a separate connection (WAL mode permits concurrent readers). A
separate `Arc<Db>` is shared between the scheduler, services, and IPC
handlers.

A `Clock` trait abstracts `now()` so tests can advance time without
sleeping.

`routines.last_fired_at` is part of V001 (was originally planned for
Phase 5; moved forward because the routine recovery path needs it on
day one).

## Consequences

Positive:
- Single source of truth: the DB. The scheduler doesn't keep its own
  state.
- Works on any OS without external dependencies.
- Recovery after crash is automatic (next poll picks up missed fires,
  but `last_fired_at` prevents re-firing routines that already fired
  in this period).
- Tests are deterministic via the `Clock` trait.

Negative:
- The app must be running for reminders to fire. Acceptable for a
  productivity app; user controls when it's open (autostart makes it
  near-always-on for desktop use).
- 5s poll latency. Tighter is possible but increases DB load. 5s is
  imperceptible for a UI alert.
- The scheduler and the suspend/resume hooks are not portable across
  all Linux compositors; we test on Hyprland (R-L4, R-L11) and accept
  the risk on others.
