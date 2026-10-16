# ADR-002: `auradesk-core` is framework-agnostic

**Status:** Accepted
**Date:** 2026-10-16

## Context

We have three places that need to invoke domain logic:

1. The Tauri desktop app (IPC commands).
2. The MCP stdio server (tool calls from Hermes).
3. Future automation (cron, CLI scripts, tests).

If the core depends on Tauri or on the MCP SDK, we couple our domain to
those frameworks and make it harder to test, embed, or reuse.

## Decision

`auradesk-core` has **zero** dependencies on Tauri, the Tauri plugin
ecosystem, or the MCP SDK. It exposes a pure-Rust API:

- Async services (`TasksService`, `RemindersService`, etc.) operating on
  `&Connection`.
- `CoreError` enum for failure modes.
- Trait `Clock` so time can be mocked in tests.

The two binaries (`auradesk`, `auradesk-mcp`) are thin shells that:

- Open the DB through `Core::new`.
- Wire each framework's request/response cycle to the appropriate
  `auradesk-core` service.
- Translate framework errors (`tauri::Error`, JSON-RPC codes) to and from
  `CoreError`.

## Consequences

Positive:
- `auradesk-core` is testable in any host. No Tauri runtime required for
  unit/integration tests.
- We can swap Tauri for a different shell (e.g. web frontend) without
  touching the domain.
- `auradesk-mcp` can ship a CLI-only version (YAGNI for MVP) by reusing
  the same services.

Negative:
- Boilerplate at the IPC/MCP boundary. Mitigated by a thin façade per
  binary (one file per resource).
- The `Clock` trait is a small abstraction tax. Worth it for testability.
