# AuraDesk

> Desktop productivity for Linux + Windows, with first-class Hermes Agent integration.

AuraDesk is a personal command-center for productivity: dashboard, tasks, kanban, reminders, Pomodoro, routines, and a chat panel that talks to the Hermes Agent via MCP.

## Status

**Pre-implementation planning phase.** The MVP design specification and architectural decision records are in this repo. Implementation begins after the spec is approved.

- 📄 **Spec:** [`docs/superpowers/specs/2026-10-16-auradesk-mvp-design.md`](docs/superpowers/specs/2026-10-16-auradesk-mvp-design.md)
- 🧭 **Decisions:** [`docs/decisions/`](docs/decisions) (11 ADRs)
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

## License

AuraDesk is offered under the **GNU General Public License, version 3
(only — not "or any later version")**. The full text is in
[`LICENSE`](LICENSE).

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
