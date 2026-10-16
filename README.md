# AuraDesk

> Desktop productivity for Linux + Windows, with first-class Hermes Agent integration.

AuraDesk is a personal command-center for productivity: dashboard, tasks, kanban, reminders, Pomodoro, routines, and a chat panel that talks to the Hermes Agent via MCP.

## Status

**Pre-implementation planning phase.** The MVP design specification and architectural decision records are in this repo. Implementation begins after the spec is approved.

- 📄 **Spec:** [`docs/superpowers/specs/2026-10-16-auradesk-mvp-design.md`](docs/superpowers/specs/2026-10-16-auradesk-mvp-design.md)
- 🧭 **Decisions:** [`docs/decisions/`](docs/decisions) (10 ADRs)
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

TBD.

## Contributing

See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) (to be added with Phase 0).
