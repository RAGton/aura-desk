# ADR-003: SQLite + rusqlite + refinery

**Status:** Accepted
**Date:** 2026-10-16

## Context

AuraDesk needs a local, file-based, single-user database. We need:

- Reliable, embedded storage with ACID.
- Migrations that can be applied on first launch and on upgrade.
- No runtime dependency hell (no native lib to install separately).
- Type-safe access from Rust, ideally with compile-time query checking.

Options considered:

- **rusqlite + refinery**: bare `sqlite3` linked at build time, raw SQL
  migrations.
- **sqlx with derive macros**: ergonomic but requires a live DB to
  compile (or `sqlx-cli` cache) and ties the project to the `sqlx` API.
- **Diesel + diesel_async**: rich schema DSL, but heavier runtime and
  more opinionated.

## Decision

Use **SQLite in WAL mode** + **rusqlite** for the connection and queries
+ **refinery** for migrations.

- Migrations are plain SQL files in `migrations/Vxxx__name.sql`, embedded
  at compile time via `include_str!`.
- `auradesk-core::infrastructure::db::Db` owns a single
  `tokio::sync::Mutex<Connection>` for writes; reads use a separate
  connection (WAL allows concurrent readers).
- `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `synchronous=NORMAL` set
  on every connection open.

## Consequences

Positive:
- Zero runtime dependency. The library is statically linked; the user
  doesn't install SQLite separately.
- Migrations are easy to read in PRs (raw SQL).
- Compile times stay low.

Negative:
- No compile-time query checking. We compensate with integration tests
  in `auradesk-core/tests/` covering every query path.
- Single-writer contention. With WAL, reads are concurrent; we serialize
  writes via mutex. Acceptable for a single-user productivity app.
