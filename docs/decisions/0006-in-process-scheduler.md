# ADR-006: In-process tokio scheduler, single-writer SQLite

**Status:** Accepted
**Date:** 2026-10-16

## Context

AuraDesk fires reminders and routines at specific times. We need a
mechanism that:

- Survives app restarts (a reminder for "3pm" should still fire after
  the app was closed at 2pm and reopened at 4pm).
- Works offline.
- Doesn't depend on systemd, cron, or Windows Task Scheduler (which have
  inconsistent UX across distros and versions).
- Is testable.

## Decision

Use a **tokio task inside the Tauri process** that:

- Polls the DB every 5 seconds for `reminders WHERE status='pending'
  AND fire_at <= now()` and `routines WHERE enabled=1` whose next
  cron tick is due.
- On restart, queries the same sets and dispatches any that are already
  due (recovery path).
- Emits a Tauri event (`reminder:fired`, `routine:fired`) which the
  frontend listens to and renders the modal.

SQLite writes are serialized via `tokio::sync::Mutex<Connection>`. Reads
use a separate connection (WAL mode permits concurrent readers). A
separate `Arc<Db>` is shared between the scheduler, services, and IPC
handlers.

A `Clock` trait abstracts `now()` so tests can advance time without
sleeping.

## Consequences

Positive:
- Single source of truth: the DB. The scheduler doesn't keep its own
  state.
- Works on any OS without external dependencies.
- Recovery after crash is automatic (next poll picks up missed fires).
- Tests are deterministic via the `Clock` trait.

Negative:
- The app must be running for reminders to fire. Acceptable for a
  productivity app; user controls when it's open (autostart makes it
  near-always-on for desktop use).
- 5s poll latency. Tighter is possible but increases DB load. 5s is
  imperceptible for a UI alert.
- A user who closes the app and reopens 3 days later will see 3 days of
  missed routine firings. We mitigate with a `last_fired_at` column on
  routines (Phase 5 enhancement if needed).
