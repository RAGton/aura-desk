# ADR-008: RRULE via the `rrule` crate, not custom

**Status:** Accepted
**Date:** 2026-10-16

## Context

AuraDesk supports recurring tasks and reminders. RFC 5545 (RRULE) is
the standard format. Implementing RRULE from scratch is a significant
effort with many edge cases (DST, exception dates, COUNT vs UNTIL,
BYDAY, BYMONTHDAY, etc.).

## Decision

Use the **`rrule` crate** (community-maintained Rust port) for RRULE
parsing and iteration. The UI exposes only presets:

- Daily
- Weekly (with weekday picker)
- Monthly (day of month)
- Cron (5-field, via `croner`)

Free-form RRULE text entry is deferred to v2. The recurrence string is
stored in `task_recurrences.rrule` and `reminders.repeat_value`.

## Consequences

Positive:
- Battle-tested parsing.
- DST and timezone handling done correctly.
- We don't reinvent the wheel.

Negative:
- One more crate to audit. Mitigated by pinning and a small surface
  (we only call `RRule::new` and `between`).
- The full RRULE spec is a surface we don't expose to users; if a user
  needs something exotic, they can't (yet) type it.
