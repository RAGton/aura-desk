# AuraDesk

> Desktop productivity for Linux + Windows, with first-class Hermes Agent integration.

AuraDesk is a personal command-center for productivity: dashboard, tasks, kanban, reminders, Pomodoro, routines, and a chat panel that talks to the Hermes Agent via MCP.

## Status

**v0.2.0 MVP Complete** — All planned MVP phases (Phases 0–5) are implemented, integrated on `main`, and verified across Rust unit/integration suites, MCP stdio tooling, Vitest frontend coverage, Playwright E2E flows, and Windows native builds:

- **Rust Workspace (`auradesk-core`, `auradesk`, `auradesk-mcp`)**: SQLite WAL writer/reader pool (`V001`–`V005`), 19 spec MCP tools over stdio, Tauri 2 tray + Compact Mode + multi-monitor + wake recovery, Hermes CLI bridge / offline proposal parser, and WAV voice capture storage.
- **Frontend (`apps/web`)**: Dashboard, Kanban board with atomic reorder, Pomodoro & Deep Focus timer, Persistent Reminders & fail-safe Alert Lock, Reports (CSV/JSON export), Hermes AI chat + Edit & Approve proposals + `ia_commands` audit log, and Settings (ZIP backup/restore, multi-monitor, autostart, themes, `pt-BR`/`en` i18n).
- **CI Gates**: `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test --workspace`, `check-strings` (0 hardcoded UI string violations), `pnpm lint` / `typecheck` / `test:coverage` / `build`, and Playwright E2E flows.

See [`CHANGELOG.md`](CHANGELOG.md) for release notes and [`docs/PHASE1_EXECUTION_REPORT.md`](docs/PHASE1_EXECUTION_REPORT.md) for stabilization history.

Documentation:

- 📄 **Spec:** [`docs/superpowers/specs/2026-10-16-auradesk-mvp-design.md`](docs/superpowers/specs/2026-10-16-auradesk-mvp-design.md)
- 📋 **Plan:** [`docs/superpowers/plans/2026-10-16-auradesk-foundation.md`](docs/superpowers/plans/2026-10-16-auradesk-foundation.md)
- 🏛️ **Architecture pointer:** [`docs/architecture/README.md`](docs/architecture/README.md)
- 🧭 **Decisions:** [`docs/decisions/`](docs/decisions) (12 ADRs)
- 💡 **Original idea:** [`IDEA.md`](IDEA.md)

## Tech stack

| Layer | Choice |
|---|---|
| Shell | Tauri 2 |
| Backend | Rust (stable) |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Storage | SQLite + rusqlite + refinery (WAL) |
| Scheduler | tokio (in-process) |
| Hermes integration | MCP stdio server (Rust) |
| Dev environment | Nix Flakes + direnv |
| CI | GitHub Actions + tauri-action |

## Repository layout

```
AuraDesk/
├── crates/
│   ├── auradesk-core/   # framework-agnostic domain + application + infrastructure
│   ├── auradesk/        # Tauri 2 binary (UI host)
│   └── auradesk-mcp/    # MCP stdio server (Hermes integration)
├── apps/
│   └── web/             # React + TS frontend
├── migrations/          # refinery SQL
├── docs/
│   ├── superpowers/
│   │   ├── specs/       # design specs
│   │   └── plans/       # implementation plans
│   └── decisions/       # ADRs
├── flake.nix            # dev shell
└── .github/workflows/   # CI + release
```

## Roadmap

Six phases, each with verifiable acceptance:

1. **Phase 0 — Foundation** (3-5 days): repo, Nix shell, Tauri opens, MCP responds, DB init, CI.
2. **Phase 1 — Tasks & Kanban** (1-2 weeks): CRUD, recurrence, kanban drag-drop, MCP tools.
3. **Phase 2 — Time** (2-3 weeks): Pomodoro, persistent reminders, routines, scheduler.
4. **Phase 3 — Desktop** (1 week): tray, multi-monitor, autostart.
5. **Phase 4 — Hermes** (1-2 weeks): in-app chat, MCP server hardening, voice capture.
6. **Phase 5 — Polish** (1 week): metrics, accessibility, i18n, export, code signing.

Full acceptance criteria live in the [spec](docs/superpowers/specs/2026-10-16-auradesk-mvp-design.md) §11.

## Phase 1 Stabilization & Architecture Foundation

Before adding cloud sync or new feature domains, Phase 1 hardens the existing Tauri 2 + React + SQLite runtime:

- **Cross-runtime interoperability**: Daily Plan payloads normalize cleanly between plain text and canonical `{"notes": ...}` JSON across Rust (`auradesk-core`) and Web fallback (`ipc.ts`); Web ZIP backup exports produce genuine PKZIP archives (`apps/web/src/lib/zip.ts`) containing `bundle.json` v2 compatible with Desktop `DataIoService`; monthly alert recurrence advances `+30d` in Web fallback as well as Rust.
- **Desktop security & fail-safe recovery**: Tightened Tauri `app.security.csp` in `crates/auradesk/tauri.conf.json` and added `alerts_emergency_unlock` (`emergency_unlock_all` + `Ctrl+Shift+U` + UI error banner/button in `AlertLockPage`) so IPC interruptions cannot leave the workstation locked.
- **SQLite concurrency & query performance**: `Db::reader()` introduces a 4-connection read-only SQLite WAL pool (`query_only = ON`) across read services while reserving `Db::writer()` for serialized transactions; `TasksService::list` pushes filtering into SQL `WHERE` clauses; `TasksService::reorder_batch` (`tasks_reorder` IPC) persists Kanban ordering atomically; `RemindersService::poll_and_fire_overdue` short-circuits via an `EXISTS` pre-check on `reader()`.
- **Frontend state & Aura Design System**: Extracted Pomodoro lifecycle/timer state into `usePomodoroController.ts`, reduced polling overhead in `AppShell.tsx` (30s interval paused when tab is hidden + selective domain refreshes), eliminated Light Mode `!important` CSS hacks using semantic RGB design tokens in `apps/web/src/styles/globals.css` + `apps/web/tailwind.config.js`, and established accessible UI primitives (`Button`, `Input`, `Badge`, `Dialog`, `Toast`, `Skeleton`, `EmptyState`) in `apps/web/src/components/ui/`.

See [`docs/PHASE1_EXECUTION_REPORT.md`](docs/PHASE1_EXECUTION_REPORT.md) and [`docs/architecture/ADR-0014-phase1-stabilization-and-design-system.md`](docs/architecture/ADR-0014-phase1-stabilization-and-design-system.md) for details.

## License

AuraDesk is offered under the **GNU General Public License, version 3
(only — not "or any later version")**. The full text is in
[`LICENSE`](LICENSE).

### License vs. copyright notice (policy pending)

The `LICENSE` file is the **GPL-3.0 text** — the authoritative grant
of permission. It is **not** the place for the copyright notice.

A project convention for the copyright notice is **proposed** but
**not yet final**. Candidates under consideration:

- A `NOTICE` file at the root of the repository.
- Per-file headers on source files (Rust, TypeScript, SQL, shell).

The final form, scope, and exact text of the notice (and which file
types carry it) are **policy pending** the identification of the
copyright holder and a confirmed convention. See
[`PENDING_LICENSE_NOTICE.md`](PENDING_LICENSE_NOTICE.md) for the open
items, and [ADR-0012](docs/decisions/0012-license.md) §4 for the
formal distinction between copyright and license.

The copyright holder has not yet been identified; see
[`PENDING_LICENSE_NOTICE.md`](PENDING_LICENSE_NOTICE.md) for the open
items that must be resolved before any public distribution.

**About commercial terms.** The copyright holder reserves the right
to offer alternative commercial license terms to specific licensees
in the future (a "dual licensing" arrangement, documented in
[ADR-0012](docs/decisions/0012-license.md)). The GPL-3.0 itself does
**not** grant exclusivity, and does not prevent third parties from
also distributing the software under the GPL. The commercial track
is available only to the specific licensee under the agreed
commercial terms, and only for the code portions whose copyright
the holder controls. No commercial terms, prices, or contracts
exist yet.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). A temporary **contribution
freeze** is in effect: external code contributions are not accepted
until a Contributor License Agreement (CLA) is in place. The freeze
exists to preserve the dual-licensing track; see
[ADR-0012](docs/decisions/0012-license.md) §5 for the rationale.
