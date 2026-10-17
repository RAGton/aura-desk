# ADR-004: MCP stdio server as primary Hermes integration (with capability registry)

**Status:** Accepted
**Date:** 2026-10-16
**Updated:** 2026-10-17

## Context

The user wants natural-language control of AuraDesk via the Hermes Agent.
Three integration models were considered:

1. **Desk spawns Hermes as a subprocess** (one-way, on-demand).
2. **Desk exposes an HTTP API** that Hermes calls (overkill for
   single-user, localhost).
3. **Desk exposes an MCP stdio server** that Hermes connects to as a
   client.

MCP is the protocol the Hermes Agent already speaks for other tools
(`codebase-memory-mcp`, etc.). It defines:

- JSON-RPC over stdio (or HTTP+SSE).
- Schema-validated tool definitions (`input_schema`, `output_schema`).
- Standard error codes (`-32601` method not found, `-32602` invalid
  params).

After the 2026-10-17 critical review, we **also** added an explicit
proposer/executor split: the IA never writes directly to `tasks` or
`reminders`; it only writes to `ia_proposals`, which the user
approves. The execute-after-approval path lives in the same capability
registry and uses the same handlers.

## Decision

**AuraDesk exposes itself as an MCP stdio server.** The binary
`auradesk-mcp` is a subcommand of the same `auradesk` binary
(`auradesk mcp`) so that the same DB, scheduler, and tool registry are
shared.

**Tool definitions and handlers live in `auradesk-core::capabilities::capabilities()`** — a single static list of `Capability` records. Each capability has a `CapabilityKind` of `Tauri`, `Mcp`, or `Both`. The Tauri IPC layer exposes a command for every `Tauri | Both` capability; the MCP server exposes a tool for every `Mcp | Both` capability. Both iterate the same list. The handler function is the same Rust code.

The audit log (`ia_commands` table) is the single source of truth for
"who did what, when, and with which args", regardless of the entry point.

## Consequences

Positive:
- Hermes becomes a first-class client without writing a custom protocol.
- Schema validation is built in; bad args are rejected before they reach
  the domain.
- DRY: one handler, two callers (Tauri IPC + MCP), structurally
  impossible to drift (R-C13 in §12.3 covers the CI test).
- The audit log lets us reason about AI actions uniformly with manual
  ones.
- Proposer/executor split is enforced by the capability kind: only
  `Mcp` capabilities can be called by the IA, and the IA's tools are
  the propose_* family — all writes go to `ia_proposals` first.

Negative:
- We depend on the MCP SDK (`rmcp`). Pin the version; isolate updates in
  the `auradesk-mcp` crate.
- MCP tool transport (stdio) is line-oriented. We must avoid printing
  anything to stdout from the MCP process except valid JSON-RPC messages.
- Adding a new capability requires editing one place but the change must
  be made with care (input_schema, output_schema, handler). Mitigated
  by the `bin/check-capabilities` script in CI (Phase 0).
