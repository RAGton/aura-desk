# ADR-004: MCP stdio server as primary Hermes integration

**Status:** Accepted
**Date:** 2026-10-16

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

## Decision

**AuraDesk exposes itself as an MCP stdio server.** The binary
`auradesk-mcp` is a subcommand of the same `auradesk` binary
(`auradesk mcp`) so that the same DB, scheduler, and tool registry are
shared.

Tool definitions live in `auradesk-core::tools/*` and are the same code
path used by:

- The Tauri IPC commands (frontend invokes them through `ipc.ts`).
- The MCP server (Hermes invokes them through JSON-RPC).

The audit log (`ia_commands` table) is the single source of truth for
"who did what, when, and with which args", regardless of the entry point.

## Consequences

Positive:
- Hermes becomes a first-class client without writing a custom protocol.
- Schema validation is built in; bad args are rejected before they reach
  the domain.
- DRY: one tool implementation, two callers.
- The audit log lets us reason about AI actions uniformly with manual
  ones.

Negative:
- We depend on the MCP SDK (`rmcp`). Pin the version; isolate updates in
  the `auradesk-mcp` crate.
- MCP tool transport (stdio) is line-oriented. We must avoid printing
  anything to stdout from the MCP process except valid JSON-RPC messages.
