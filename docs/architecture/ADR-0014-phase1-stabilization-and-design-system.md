# ADR-0014: Phase 1 Stabilization, Concurrency & Aura Design System Foundation

**Status:** Accepted
**Date:** 2026-11-15

## Context

Following the Phase 1 architectural audit of AuraDesk, several reliability, performance, security, and maintainability bottlenecks needed remediation without altering the SQLite schema, adding cloud/auth infrastructure prematurely, or regressing existing Desktop (Tauri 2) and Browser fallback functionality:

1. **Cross-runtime data & backup mismatches:**
   - Plain-text Daily Plan notes could diverge between Rust SQLite persistence and the browser `localStorage` fallback.
   - Browser backup exports generated JSON envelopes rather than valid PKZIP archives interoperable with Desktop `DataIoService`.
   - Browser `alerts_resolve` omitted the `monthly` reminder recurrence branch.
2. **Desktop lock safety & CSP:**
   - `AlertLock` windows had no fail-safe unlock path if IPC calls (`alerts_resolve` / `alerts_dismiss`) failed.
   - Tauri CSP needed explicit directives restricting script/style/connect sources.
3. **Database & IPC contention:**
   - Read queries acquired the single global SQLite writer mutex (`Db::writer()`).
   - `TasksService::list` loaded tasks broadly before filtering and Kanban column reorders issued N sequential IPC updates.
   - `RemindersService::poll_and_fire_overdue` acquired `writer()` every second even when zero reminders were overdue.
   - `AppShell.tsx` mixed Pomodoro timer state with shell layout and polled aggressively regardless of tab visibility.
4. **Theming & UI primitives:**
   - `globals.css` relied on `!important` overrides for Light Mode, and `apps/web/src/components/ui/` lacked standardized accessible primitives.
   - `ADR-005` originally anticipated Tailwind v4 + shadcn/ui copy-paste components with Radix primitives, whereas the active workspace runs **Tailwind CSS v3.4** (`apps/web/tailwind.config.js`) with `class-variance-authority`, `clsx`, `tailwind-merge`, and `lucide-react`—and zero `@radix-ui/*` packages installed.

## Decisions

### 1. Cross-Runtime Data & Archive Interoperability (No Schema Change)
- Normalize Daily Plan text payloads to canonical `{"notes": ...}` JSON (preserving existing JSON objects/arrays and clearing blank strings to `NULL`) in both `crates/auradesk-core/src/application/daily_plans.rs` (`normalize_plan_payload`) and `apps/web/src/lib/ipc.ts` (`serializeDailyPlanNotes` / `parseDailyPlanNotes`).
- Implement a zero-dependency PKZIP Store (method 0) + IEEE 802.3 CRC-32 encoder/decoder and `DecompressionStream("deflate-raw")` async decoder in `apps/web/src/lib/zip.ts`. Both runtimes exchange `bundle.json` v2 inside real PKZIP archives (`data_export_zip` / `data_import_zip` and `DataIoService::import_zip_bytes`).
- Handle `monthly` (`+ 30 * 86_400_000`) recurrence in browser `alerts_resolve` to stay aligned with Desktop tests and reminders behavior.

### 2. AlertLock Fail-Safe & Tauri CSP
- Tighten `app.security.csp` in `crates/auradesk/tauri.conf.json`.
- Expose `alerts_emergency_unlock` (`emergency_unlock_all` in `crates/auradesk/src/alert_lock.rs`), mirrored in browser fallback (`ipc.ts`), wired in `AlertLockPage.tsx` via an inline error recovery banner, visible Emergency Unlock buttons, and the global `Ctrl+Shift+U` keyboard shortcut.

### 3. SQLite WAL Reader Pool & Query Pushdown
- Extend `Db` (`crates/auradesk-core/src/infrastructure/db.rs`) with a 4-connection round-robin read-only pool (`SQLITE_OPEN_READ_ONLY`, `PRAGMA query_only = ON`, `busy_timeout = 5000`) accessed via `Db::reader()` (falling back to `writer()` for in-memory test databases).
- Migrate read operations across `auradesk-core` application services to `db.reader()` while preserving `db.writer()` for transactional writes.
- Move `TasksService::list` filtering (`status`, `project_id`, `top_level_only`, `overdue`) into parameterized SQL `WHERE` predicates.
- Add transactional `TasksService::reorder_batch` + `tasks_reorder` IPC command (`tasksApi.reorder`) so Kanban reorder mutations complete atomically in a single IPC call.
- Guard `RemindersService::poll_and_fire_overdue` with an `EXISTS` pre-check on `db.reader()` before opening a write transaction.

### 4. Frontend Modularization & Polling Efficiency
- Extract Pomodoro timer, `sessionStorage` pause cache, countdown auto-completion, and lifecycle actions into `apps/web/src/hooks/usePomodoroController.ts`.
- Adjust `AppShell.tsx` default refresh cadence to 30 seconds, skip polling when `document.visibilityState === "hidden"`, refresh immediately on `visibilitychange`, and introduce selective domain refreshes (`refreshTasksDomain`, `refreshAlertsDomain`, `refreshPomodoroDomain`).

### 5. Aura Design System: Semantic Tokens & Zero-Dependency Primitives
- Replace Light Mode `!important` CSS hacks in `apps/web/src/styles/globals.css` with semantic RGB triplet custom properties (`--bg-*`, `--text-*`, `--border-*`, `--accent-*`, `--status-*`, `--radius-*`, `--shadow-*`) mapped under `theme.extend` (`aura.*`) in `apps/web/tailwind.config.js`.
- Evaluate shadcn/ui + Radix UI vs zero-dependency React primitives:
  - Adding `@radix-ui/react-dialog`, `@radix-ui/react-toast`, etc. solely for 7 foundational primitives would expand `node_modules`/bundle surface without providing behavior that small, focused ARIA primitives cannot cover cleanly.
  - Because `class-variance-authority`, `clsx`, `tailwind-merge`, and `lucide-react` are already installed, Phase 1 implements self-contained accessible primitives (`Button`, `Input`, `Badge`, `Dialog`, `Toast`, `Skeleton`, `EmptyState`) in `apps/web/src/components/ui/` with explicit `role="dialog"`, `aria-modal`, `Escape` dismissal, focus restoration, `role="status"`/`"alert"` live regions, and `useId()` form wiring—and reserves adding Radix later only if complex menus/comboboxes require floating positioning in future phases.

## Consequences

- **Zero new dependencies** added to `Cargo.toml` or `apps/web/package.json`.
- **Zero database schema migrations** required; existing `V001`–`V003` remain untouched and backward-compatible.
- **Improved read concurrency & IPC efficiency** while retaining full offline Desktop/Browser testability.
- **Visual tokens and primitives are ready** for progressive adoption across feature pages in Phase 2 without risky mass rewrites.
