# ADR-001: Mono-repo workspace (Cargo + pnpm)

**Status:** Accepted
**Date:** 2026-10-16

## Context

AuraDesk is a Rust + TypeScript project. We need to decide whether to keep
backend (`crates/*`) and frontend (`apps/web`) in one repository with a
shared workspace, or split them across two repositories with versioning
overhead.

## Decision

Use a **single mono-repo** with two workspaces:

- Cargo workspace at the root, members: `crates/auradesk-core`,
  `crates/auradesk`, `crates/auradesk-mcp`.
- pnpm workspace at the root, members: `apps/web`.

A `flake.nix` provides a unified dev shell for both. CI builds the whole
tree in one go and produces one release artifact (Tauri bundle) per OS.

## Consequences

Positive:
- Atomic refactors across the FFI/IPC boundary; no version skew between
  Rust commands and TS wrappers.
- Single PR covers both sides of a feature.
- Single CI pipeline; one source of truth for toolchain versions.
- `flake.nix` is read once and pins everything.

Negative:
- The repo grows. We need clear ownership boundaries (the `Boundary rules`
  in `docs/superpowers/specs/2026-10-16-auradesk-mvp-design.md` §6.1).
- Build times for the Tauri bundle include both Rust and TS. Mitigated by
  incremental compilation and Tauri 2's split dev/build commands.
