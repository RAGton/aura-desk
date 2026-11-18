# Changelog

All notable changes to AuraDesk are documented in this file.

## [0.2.0] - 2026-11-18

### Added
- **Phase 4 — Hermes Agent Integration & Audit (`#17`)**:
  - Added in-app **Hermes AI** tab (`apps/web/src/features/hermes-chat/HermesChatPanel.tsx`) featuring a conversational composer, offline intent parser (`cria tarefa` / `create task`, `lembrete` / `remind me`, `resumo` / `summary`), optional live `hermes` CLI streaming (`auradesk://hermes-stream`), and full browser localStorage fallback.
  - Added **Edit & Approve** (`modifications` override payload for title & priority) and decision notes in the Proposal Approval Queue (`proposals_approve`, `proposals_list_recent`, `proposals_reject`).
  - Added the **IA Command Audit Log** viewer backed by SQLite `ia_commands` (`ia_commands_list`) and updated `proposals` badge sync (`auradesk://proposals-updated`).
  - Added local **16-bit mono PCM WAV** audio capture (`apps/web/src/lib/wav.ts`) persisted via `audio_capture_save` into `<data_dir>/voice-captures/`.
- **Phase 3 — Desktop Integration (`#16`)**:
  - Added **Compact Floating Mode** (`/compact`, always-on-top mini widget), multi-monitor window placement with fallback strategies (`primary_then_hide`, `primary`, `hide`), `--tray` startup flag, upgraded system tray menu (`Show`, `Compact Mode`, `Open Hermes Proposals`, `Pause Alerts`, `Quit`), autostart toggles (Windows Registry Run / Linux XDG desktop entry), and OS suspend/resume wake-up recovery (`WakeSignal` + Win32 `WM_POWERBROADCAST`).
- **Phase 2 — Health, Validation & Test Hygiene (`#15`)**:
  - Switched `report_summary` read-only queries to SQLite WAL `db.reader()`, added React Router v7 future flags, Playwright local Chrome/Edge auto-detection, task input validation (`estimate_min`, `due_at`), async unmount guards, and expanded controller/page unit test coverage.
- **Phase 1 / 1.5 — Stabilization & Design System (`#14`, `#1`–`#13`)**:
  - Added SQLite WAL 4-connection reader pool, SQL-level task filtering and transactional Kanban batch reorder, `.zip` backup export/import interoperability, fail-safe Alert Lock screen emergency unlock (`Ctrl+Shift+U`), external Alert Modal (`alert-popup`), Pomodoro-aware routines, and the Aura Glass Design System (`pt-BR` / `en`).

## [0.1.0] - 2026-10-16

### Added
- Initial AuraDesk Foundation: Tauri 2 desktop host (`auradesk`), core Rust library (`auradesk-core`) with `V001`–`V003` SQLite migrations and 19 spec capabilities, stdio MCP server (`auradesk-mcp`), React/Vite frontend (`apps/web`), and CI/Release workflows.
