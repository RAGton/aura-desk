# AuraDesk — Phase 0 Foundation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a buildable, testable, license-clean foundation for AuraDesk: Nix dev shell, Cargo + pnpm workspaces, the three crates (`auradesk-core`, `auradesk`, `auradesk-mcp`), the SQLite schema applied on first run, a Tauri window that opens with a tray icon, a stdio MCP server that answers `initialize` and `tools/list: []`, the React/TS frontend wired to Tauri, i18n from day one, and CI on Linux + Windows.

**Architecture:** Two binaries (Tauri + MCP) share one framework-agnostic Rust library (`auradesk-core`). SQLite in WAL mode with refinery migrations. Capability registry in `auradesk-core::capabilities::capabilities()` is a single static list consumed by both binaries. Linux-first Nix dev shell; Tauri 2 + WebView2 on Windows.

**Tech Stack:** Rust (stable, 1.82), Tauri 2, React 18 + TypeScript + Vite, Tailwind CSS v4, shadcn/ui (copy-paste), SQLite + rusqlite (`bundled` feature) + refinery, tokio, MCP SDK (`rmcp`), Nix Flakes, GitHub Actions (`tauri-action`).

**Spec:** [`../specs/2026-10-16-auradesk-mvp-design.md`](../specs/2026-10-16-auradesk-mvp-design.md)
**License ADR:** [`../../decisions/0012-license.md`](../../decisions/0012-license.md)
**Dependency audit:** [`dependency-license-audit.md`](dependency-license-audit.md)

## Global Constraints

These apply to **every** task below. The spec is the source of truth for project-level rules; this section is the snapshot for Phase 0 specifically.

- **Rust edition:** 2021. **MSRV:** 1.82.
- **Tauri version:** 2.x (pinned exact minor in `Cargo.toml`).
- **Frontend:** Node 22.x via Nix dev shell. `pnpm` only (no `npm`/`yarn` lockfiles).
- **DB:** `rusqlite` with `bundled` feature; no system SQLite. `journal_mode=WAL`; `foreign_keys=ON`; `synchronous=NORMAL`.
- **Migrations:** plain SQL files in `migrations/Vxxx__name.sql`, embedded via `include_str!`. Run by refinery on first launch and on upgrade.
- **License of AuraDesk source code:** GPL-3.0-only. See ADR-0012. The project copyright line in the `LICENSE` file is **NOT** added in Phase 0; the placeholder is documented in `PENDING_LICENSE_NOTICE.md` at the root and the file is not modified.
- **External code contributions:** frozen. No PRs accepted that contain code. Issue reports, typos, doc fixes, and translation work that does not constitute new code are welcome. See `CONTRIBUTING.md`.
- **i18n:** all user-facing strings in `apps/web/src` go through `react-i18next` keys; same for Rust via `rust-i18n`. The `bin/check-strings` script enforces this in CI.
- **Naming:** project id `com.ragton.auradesk` (Tauri `identifier`, Windows AppUserModelID, NSIS package id). Repository name `aura-desk`. Display name "AuraDesk".
- **Code formatting:** `cargo fmt --check` and `cargo clippy --workspace --all-targets -- -D warnings` must pass. `pnpm lint` and `pnpm tauri build` must succeed on Linux and Windows-latest in CI.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`). Push after every change. Per-file commit where reasonable.
- **No code modifications without spec** for anything outside Phase 0 scope. Spec is the contract.
- **No `NOTICE` file** unless an actual asset demands one (per the dependency audit, none does in Phase 0).
- **shadcn/ui copy-paste MIT preservation** is enforced by a CI check (in this plan) that fails on the absence of the upstream MIT copyright notice in any file under `apps/web/src/components/ui/`.

## Review Focus

The five input classes / failure modes the spec implies but no task's tests directly exercise that are most likely to bite a person using this software — listed here once, with the test that pins each line added to the owning task.

1. **First-launch DB on a system with no prior `auradesk` data dir** (e.g. brand-new user, no XDG_DATA_HOME yet). → Task 4 test: open the DB in a temp dir, run migrations, verify all 13 tables + 31 indexes exist.
2. **The MCP server's stdout must contain only valid JSON-RPC** (no logs, no debug prints, no accidental `println!`). → Task 5 test: send `tools/list`, capture stdout, assert it parses as a single JSON object and contains no other lines.
3. **Closing the Tauri window must NOT exit the process** (the spec's "Fechar a janela principal: processo continua, ícone persiste" rule). → Task 5 test: invoke the close-window behavior, assert the process PID is still alive 2 seconds later and the tray icon is still in the icon list.
4. **The Nix dev shell must fail with a clear message when flakes are not enabled**, not a confusing internal Nix error. → Task 1 test: temporarily disable `experimental-features`, run `nix develop --extra-experimental-features '' --command true`, assert the warning text appears on stderr.
5. **A `tauri-plugin-*` upgrade must not break the build silently** because the Cargo pin is too loose. → Task 1: the Nix dev shell pins all Tauri deps via `Cargo.toml` exact versions; CI uses `--locked` against a checked-in `Cargo.lock`.

## File Structure (post-Phase 0)

The Phase 0 implementation produces the structure below. Files marked **(new)** are created; files marked **(verified)** already exist and are not modified unless noted.

```
AuraDesk/
├── Cargo.toml                                  (new) — workspace root
├── pnpm-workspace.yaml                         (new)
├── package.json                                (new) — pnpm workspace root
├── tsconfig.base.json                          (new)
├── flake.nix                                   (new)
├── .envrc                                      (new)
├── .gitignore                                  (verified; expand)
├── README.md                                   (verified; §"Status" updated at end)
├── LICENSE                                     (verified; already GPL-3.0 verbatim)
├── PENDING_LICENSE_NOTICE.md                   (verified; already there)
├── CONTRIBUTING.md                             (verified; already there)
├── IDEA.md                                     (verified)
│
├── crates/
│   ├── auradesk-core/
│   │   ├── Cargo.toml                          (new)
│   │   ├── src/
│   │   │   ├── lib.rs                          (new)
│   │   │   ├── error.rs                        (new)
│   │   │   ├── domain/mod.rs                   (new — placeholder)
│   │   │   ├── application/mod.rs              (new — placeholder)
│   │   │   ├── infrastructure/mod.rs           (new)
│   │   │   ├── infrastructure/db/mod.rs        (new)
│   │   │   ├── infrastructure/db/migrations.rs (new)
│   │   │   ├── infrastructure/db/ulid.rs       (new)
│   │   │   ├── capabilities.rs                 (new — empty stub)
│   │   │   ├── i18n.rs                         (new — rust-i18n init)
│   │   │   └── locales/{en,pt-BR}.yml         (new — empty)
│   │   └── tests/db_init.rs                    (new)
│   ├── auradesk/
│   │   ├── Cargo.toml                          (new)
│   │   ├── tauri.conf.json                     (new)
│   │   ├── build.rs                            (new)
│   │   ├── capabilities/default.json           (new)
│   │   ├── icons/{32x32,128x128,128x128@2x}.png  (new — placeholder)
│   │   └── src/
│   │       ├── main.rs                         (new)
│   │       ├── runtime.rs                      (new)
│   │       ├── ipc/mod.rs                      (new — placeholder)
│   │       ├── tray/mod.rs                     (new)
│   │       └── windows/mod.rs                  (new)
│   └── auradesk-mcp/
│       ├── Cargo.toml                          (new)
│       └── src/
│           ├── main.rs                         (new)
│           ├── server.rs                       (new)
│           └── errors.rs                       (new)
│
├── apps/web/                                   (new)
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── components.json                         (shadcn config)
│   ├── index.html
│   ├── locales/{pt-BR,en}.json
│   ├── public/
│   │   └── sounds/                             (Phase 2 deliverable, empty in Phase 0)
│   └── src/
│       ├── main.tsx
│       ├── app/
│       │   ├── router.tsx
│       │   └── layout/AppShell.tsx
│       ├── components/
│       │   └── ui/                             (shadcn copy-paste happens in Phase 1+; empty in Phase 0)
│       ├── lib/
│       │   ├── ipc.ts
│       │   ├── i18n.ts
│       │   └── utils.ts
│       └── styles/globals.css
│
├── migrations/
│   └── V001__init.sql                          (new — verbatim of spec §7.2)
│
├── scripts/
│   └── check-strings.sh                        (new — wrapper around bin/check-strings)
│
├── .github/
│   └── workflows/
│       ├── ci.yml                              (new)
│       └── release.yml                         (new)
│
└── docs/
    ├── superpowers/
    │   ├── specs/2026-10-16-auradesk-mvp-design.md  (verified)
    │   └── plans/2026-10-16-auradesk-foundation.md  (this file)
    ├── decisions/{0001..0012}.md                    (verified)
    ├── licensing/dependency-license-audit.md        (verified)
    └── architecture/                                (new — placeholder)
```

---

### Task 0: License baseline verification (no new code)

**Files:**
- Verify: `LICENSE` (root)
- Verify: `PENDING_LICENSE_NOTICE.md` (root)
- Verify: `CONTRIBUTING.md` (root)
- Verify: `docs/decisions/0012-license.md`
- Verify: `docs/licensing/dependency-license-audit.md`

**Why this is the first task:** every later task touches code; code is offered under GPL-3.0. The owner must confirm the license setup is what they want before any line of code is written.

- [ ] **Step 1: Verify the LICENSE file is the verbatim GPL-3.0 text.**

  Run: `sha256sum LICENSE`
  Expected: `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`
  Fail mode: if the hash does not match, do **not** modify the file; flag the discrepancy to the owner.

- [ ] **Step 2: Verify the four supporting documents exist and are non-empty.**

  Run: `for f in PENDING_LICENSE_NOTICE.md CONTRIBUTING.md docs/decisions/0012-license.md docs/licensing/dependency-license-audit.md; do test -s "$f" || echo "MISSING/EMPTY: $f"; done`
  Expected: no output (all four exist and are non-empty).

- [ ] **Step 3: Read `PENDING_LICENSE_NOTICE.md` end-to-end with the owner.**

  This file lists four questions that must be answered before the next public distribution. The plan does not block on them — Phase 0 is internal development — but the owner should confirm the wording of the freeze and the questions are acceptable as written.

- [ ] **Step 4: Confirm `docs/decisions/0012-license.md` is the accepted license basis.**

  Open the file, read §1 (Public license: GPL-3.0-only) and §5 (Temporary contribution freeze). The owner must acknowledge that no PR-based contribution will be accepted in Phase 0.

- [ ] **Step 5: Commit (if any new file landed in this task; typically none) and continue.**

  No commit expected for Task 0 if the four files already exist. If any were missing, they would be created by an earlier turn (which has already happened) and verified here.

**Gate:** all four files exist, LICENSE has the correct SHA-256, owner has acknowledged the freeze.

---

### Task 1: Nix dev shell + direnv

**Files:**
- Create: `flake.nix`
- Create: `.envrc`
- Modify: `.gitignore` (add `.direnv/`)

**Interfaces:**
- Consumes: nothing (greenfield)
- Produces: a `nix develop` shell that exposes `cargo`, `rustc`, `node`, `pnpm`, `pkg-config`, and the system libs Tauri needs on Linux. The shell prints a banner with the Rust and Node versions and warns if `nix develop` was launched without the `flakes` experimental feature.

- [ ] **Step 1: Write the failing pre-flight check.**

  Before creating `flake.nix`, run:
  `nix --version ; nix show-config 2>/dev/null | grep -E "experimental-features.*flakes" || echo "flakes: NOT ENABLED"`

  Expected: `nix` is present; flakes may or may not be enabled. If flakes are not enabled, the next steps must keep the manual fallback (`nix develop --experimental-features 'nix-command flakes'`) documented.

- [ ] **Step 2: Create `flake.nix` with the dev shell from spec §9.1.**

  Use the verbatim Nix code from the spec, with these pin values:
  - `nixpkgs` = `github:NixOS/nixpkgs/nixos-unstable`
  - `rust-overlay` = `github:oxalica/rust-overlay`
  - `flake-utils` = `github:numtide/flake-utils`
  - `rust-bin.stable."1.82.0".default.override { extensions = [ "rust-src" "rust-analyzer" "clippy" "rustfmt" ]; }`
  - `nodejs_22`, `pnpm`, `pkg-config`, `openssl`, `webkit2gtk_4_1`, `libsoup_3`, `gtk3`, `libayatana-appindicator`, `librsvg`, `xdg-utils`, `binaryen`, `wayland`, `wlr-protocols`
  - Shell hook sets `PKG_CONFIG_PATH`, `RUST_SRC_PATH`, `WEBKIT_DISABLE_COMPOSITING_MODE=1`
  - Shell hook detects missing `experimental-features = nix-command flakes` and prints a clear warning + remediation (`~/.config/nix/nix.conf` snippet).

- [ ] **Step 3: Create `.envrc` with `use flake`.**

  This is the single line `use flake`, no other content.

- [ ] **Step 4: Update `.gitignore` to exclude `.direnv/`.**

  Add `.direnv/` to the existing `.gitignore`.

- [ ] **Step 5: Verify the shell opens and tools are present.**

  Run: `nix develop --command bash -c 'echo "rust: $(rustc --version)"; echo "cargo: $(cargo --version)"; echo "node: $(node --version)"; echo "pnpm: $(pnpm --version)"'`
  Expected: four lines, each with a recognizable version string. Any error → fix the flake, re-run.

- [ ] **Step 6: Verify the flakes-warning fires when features are off (manual).**

  Run once: `NIX_CONFIG="" nix develop --command bash -c 'true' 2>&1 | head -20`
  Expected: the shell starts. If the user has flakes enabled (default on modern Nix), nothing is printed. If they don't, the warning is printed. Either outcome is acceptable; the warning is **conditional** on `nix show-config` reporting no `flakes` in `experimental-features`.

- [ ] **Step 7: Commit.**

  ```bash
  git add flake.nix .envrc .gitignore
  git commit -m "build: add Nix dev shell + direnv integration"
  ```

**Gate:** `nix develop` opens a shell with all four tools (`rustc`, `cargo`, `node`, `pnpm`) and the documented warning behavior.

---

### Task 2: Cargo workspace + pnpm workspace

**Files:**
- Create: `Cargo.toml` (workspace root)
- Create: `pnpm-workspace.yaml`
- Create: `package.json` (root, pnpm)
- Create: `tsconfig.base.json`
- Create: `crates/auradesk-core/Cargo.toml` (stub)
- Create: `crates/auradesk/Cargo.toml` (stub)
- Create: `crates/auradesk-mcp/Cargo.toml` (stub)

**Interfaces:**
- Consumes: Task 1 (toolchain)
- Produces: a buildable workspace with three crates (empty main.rs / lib.rs each) and a pnpm workspace pointing at `apps/web` (apps/web created in Task 6; the pnpm-workspace.yaml can list it before apps/web exists, pnpm will warn but the file is structurally correct).

- [ ] **Step 1: Write the failing `cargo metadata` test.**

  Before creating the workspace, run `cargo metadata --no-deps 2>&1 | head -3`.
  Expected: "could not find `Cargo.toml` in `/.../AuraDesk`" or similar — confirms the test is "this command must succeed once the workspace exists".

- [ ] **Step 2: Create the root `Cargo.toml` workspace.**

  ```toml
  [workspace]
  resolver = "2"
  members = ["crates/*"]
  ```

- [ ] **Step 3: Create `crates/auradesk-core/Cargo.toml`.**

  ```toml
  [package]
  name = "auradesk-core"
  version = "0.1.0"
  edition = "2021"
  ```

  Plus empty `src/lib.rs` containing `//! AuraDesk core: framework-agnostic domain + application + infrastructure.`

- [ ] **Step 4: Create `crates/auradesk/Cargo.toml` and `crates/auradesk-mcp/Cargo.toml`.**

  Mirror Task 2 step 3 with `name = "auradesk"` and `name = "auradesk-mcp"`, and an empty `src/main.rs` (`fn main() {}`).

- [ ] **Step 5: Create `pnpm-workspace.yaml`.**

  ```yaml
  packages:
    - "apps/*"
  ```

- [ ] **Step 6: Create root `package.json`.**

  Minimal:
  ```json
  { "name": "aura-desk-workspace", "private": true, "version": "0.1.0", "packageManager": "pnpm@9.x" }
  ```
  (Replace the `9.x` with the version the dev shell installs.)

- [ ] **Step 7: Create `tsconfig.base.json`.**

  Minimal TS config with `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`, `jsx: react-jsx`. This will be extended by `apps/web/tsconfig.json` in Task 6.

- [ ] **Step 8: Run `cargo metadata --no-deps`.**

  Expected: exits 0, prints workspace info with three members.

- [ ] **Step 9: Run `cargo build --workspace`.**

  Expected: builds three stub crates, exits 0, no warnings (clippy not yet enforced; just plain cargo).

- [ ] **Step 10: Commit.**

  ```bash
  git add Cargo.toml pnpm-workspace.yaml package.json tsconfig.base.json crates/
  git commit -m "build: scaffold cargo + pnpm workspaces with three empty crates"
  ```

**Gate:** `cargo build --workspace` succeeds; `pnpm install` at the root is a no-op (no `apps/*` yet) and exits 0.

---

### Task 3: auradesk-core — domain, application, infrastructure skeletons

**Files:**
- Create: `crates/auradesk-core/src/lib.rs`
- Create: `crates/auradesk-core/src/error.rs`
- Create: `crates/auradesk-core/src/domain/mod.rs`
- Create: `crates/auradesk-core/src/application/mod.rs`
- Create: `crates/auradesk-core/src/infrastructure/mod.rs`
- Create: `crates/auradesk-core/src/capabilities.rs`
- Create: `crates/auradesk-core/src/i18n.rs`
- Create: `crates/auradesk-core/locales/{en,pt-BR}.yml`

**Interfaces:**
- Consumes: Task 2
- Produces: a library with three top-level modules (domain / application / infrastructure), a `CoreError` enum (variants needed by Phase 0: `Validation`, `Internal`, `NotFound`), a `capabilities()` function returning `&'static [Capability]` (empty for now), an `i18n` initializer. No tests in this task; tests are added in Task 4 and Task 5.

- [ ] **Step 1: Write `error.rs` with the `CoreError` variants needed for Phase 0.**

  Use `thiserror`. Variants: `Validation { field: String, reason: String }`, `NotFound { entity: String, id: String }`, `Internal { source: Box<dyn std::error::Error + Send + Sync> }`. Each variant derives `Debug, Clone, PartialEq, Eq` (with the caveat that `Internal` may need to skip `PartialEq, Eq`; use `#[from]` only where it does not cost runtime overhead).

- [ ] **Step 2: Re-export the error in `lib.rs`.**

  Add `pub mod error; pub use error::CoreError;` and a top-level `//!` doc comment.

- [ ] **Step 3: Create the three placeholder modules.**

  Each of `domain/mod.rs`, `application/mod.rs`, `infrastructure/mod.rs` gets a `//!` module doc comment. The bodies are empty `mod`s for now.

- [ ] **Step 4: Create the `capabilities.rs` stub.**

  A `Capability` struct (name, description, kind, input_schema, output_schema) and a `CapabilityKind` enum (`Tauri`, `Mcp`, `Both`). The function `pub fn capabilities() -> &'static [Capability] { &[] }` returns an empty slice. This is the placeholder that Phase 1+ will populate.

- [ ] **Step 5: Create the `i18n.rs` stub.**

  Use `rust-i18n` to set the i18n backend; `rust_i18n::i18n!("locales")` and a `pub fn set_locale(locale: &str)`. Locales are loaded from `crates/auradesk-core/locales/{en,pt-BR}.yml` (created in the next step).

- [ ] **Step 6: Create the two empty locale files.**

  `crates/auradesk-core/locales/en.yml` and `crates/auradesk-core/locales/pt-BR.yml`, each containing only the `_: hello` key as a sanity placeholder. Real keys are added in Phase 1+.

- [ ] **Step 7: Run `cargo build -p auradesk-core`.**

  Expected: builds without errors. Warnings about unused imports / fields are fine for now (clippy is not yet enforced).

- [ ] **Step 8: Commit.**

  ```bash
  git add crates/auradesk-core/
  git commit -m "feat(core): scaffold domain/application/infrastructure modules + error + capabilities stub + i18n"
  ```

**Gate:** `cargo build -p auradesk-core` succeeds. `pub use auradesk_core::CoreError;` is reachable from the workspace root.

---

### Task 4: SQLite Db + refinery migration V001

**Files:**
- Create: `migrations/V001__init.sql` (verbatim from spec §7.2)
- Create: `crates/auradesk-core/src/infrastructure/db/mod.rs`
- Create: `crates/auradesk-core/src/infrastructure/db/migrations.rs`
- Create: `crates/auradesk-core/src/infrastructure/db/ulid.rs`
- Create: `crates/auradesk-core/tests/db_init.rs`
- Create: `crates/auradesk-core/Cargo.toml` (modify; add deps + feature for refinery embed)

**Interfaces:**
- Consumes: Task 3
- Produces: `auradesk_core::infrastructure::db::Db::open(path: &Path) -> Result<Db, CoreError>` plus a `Db::conn() -> &Connection` accessor and a `Db::migrate() -> Result<(), CoreError>` method. Migration SQL is embedded via `refinery::embed_migrations!` pointing at the `migrations/` directory at the repo root.

- [ ] **Step 1: Copy `migrations/V001__init.sql` from the spec.**

  The exact content of spec §7.2. Verify by `diff` against the spec; the spec is the source of truth.

- [ ] **Step 2: Write the failing test (`crates/auradesk-core/tests/db_init.rs`).**

  Test cases:
  - `open_in_temp_dir_succeeds`: create a `tempfile::TempDir`, call `Db::open(dir.path())`, assert `is_ok`.
  - `migrate_creates_all_tables`: open + migrate, query `sqlite_master` for `type='table'`, assert the count is at least 13 and that each expected table name is present.
  - `migrate_creates_index_count`: same as above for indexes (at least 31).
  - `migrate_seeds_settings`: open + migrate, `SELECT key, value FROM settings`, assert 16 rows (the 16 keys listed in spec §7.3).
  - `journal_mode_is_wal`: after open, query `PRAGMA journal_mode`, assert the result is `wal`.
  - `foreign_keys_are_on`: after open, query `PRAGMA foreign_keys`, assert the result is `1`.

  Use `rstest` for fixtures. The `tempfile` dev-dep is added in the next step.

- [ ] **Step 3: Update `crates/auradesk-core/Cargo.toml` with deps.**

  Add under `[dependencies]`:
  - `rusqlite = { version = "0.32", features = ["bundled"] }`
  - `refinery = { version = "0.8", features = ["rusqlite"] }`
  - `ulid = "1"`
  - `thiserror = "1"`
  - `tracing = "0.1"`
  - `parking_lot = "0.12"`
  - `tokio = { version = "1", features = ["rt-multi-thread", "sync", "time"] }`
  - `rust-i18n = "4"`
  - `dirs = "5"`

  Add under `[dev-dependencies]`:
  - `tempfile = "3"`
  - `rstest = "0.21"`

  Add under `[features]`:
  - `default = []`

  Add under `[lints.clippy]`:
  - `all = { level = "warn", priority = -1 }`
  - `pedantic = { level = "warn", priority = -1 }`
  - `unwrap_used = "warn"`
  - `expect_used = "warn"`

- [ ] **Step 4: Run the test to verify it fails (RED).**

  Run: `cargo test -p auradesk-core --test db_init`
  Expected: build error (no `Db` yet) or runtime panic.

- [ ] **Step 5: Implement `Db::open` and `Db::migrate` in `infrastructure/db/mod.rs`.**

  The implementation:
  - Calls `Connection::open(path.join("auradesk.db"))`.
  - Sets `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, `PRAGMA synchronous=NORMAL` (verify each via a follow-up `query_row`).
  - Wraps the connection in an `Arc<Mutex<Connection>>` (using `parking_lot::Mutex`; or `tokio::sync::Mutex` if async is needed; spec §6.1 says single-writer, so `parking_lot` is sufficient and faster).
  - Calls `embedded_migrations::runner().run_async(&mut client_async)`. **Note:** the `refinery` async API requires `tokio-postgres` or `mysql_async`; for `rusqlite` we use the **sync** `run` method, not `run_async`. The DB construction is sync, but the spec says services can be `async`; the connection is held in a `Mutex` and the `Connection::open` + migrations are sync; the service layer awaits a `spawn_blocking` if it needs to be async.
  - The migration runner uses `refinery::embed_migrations!` with the `migrations/` directory at the workspace root. The macro path is relative to `Cargo.toml`, so it resolves to `auradesk-core/migrations/`; **copy** (do not symlink) `migrations/V001__init.sql` into `crates/auradesk-core/migrations/V001__init.sql` so the `include_str!` and the macro both work, and verify by `sha256sum` that the two copies match. The audit table for refinery is created automatically.

- [ ] **Step 6: Run the test (GREEN).**

  Run: `cargo test -p auradesk-core --test db_init`
  Expected: 6 tests pass.

- [ ] **Step 7: Run clippy on the new code.**

  Run: `cargo clippy -p auradesk-core --all-targets -- -D warnings`
  Expected: clean. If pedantic lints fire on infrastructure code, fix them; do not silence with `#[allow]`.

- [ ] **Step 8: Commit.**

  ```bash
  git add migrations/ crates/auradesk-core/migrations/ crates/auradesk-core/src/infrastructure/ crates/auradesk-core/tests/ crates/auradesk-core/Cargo.toml
  git commit -m "feat(core): SQLite Db with refinery, V001 migration, WAL mode + 16 settings seed"
  ```

**Gate:** all 6 tests in `db_init.rs` pass; the DB created in a temp dir contains all 13 tables, 31 indexes, 16 settings rows, and 3 routines. `cargo clippy` passes.

---

### Task 5: auradesk — Tauri binary with Hello window + tray

**Files:**
- Create: `crates/auradesk/Cargo.toml` (modify; add tauri + plugins)
- Create: `crates/auradesk/tauri.conf.json`
- Create: `crates/auradesk/build.rs`
- Create: `crates/auradesk/capabilities/default.json`
- Create: `crates/auradesk/icons/32x32.png`, `128x128.png`, `128x128@2x.png` (placeholders)
- Create: `crates/auradesk/src/main.rs`
- Create: `crates/auradesk/src/runtime.rs`
- Create: `crates/auradesk/src/ipc/mod.rs`
- Create: `crates/auradesk/src/tray/mod.rs`
- Create: `crates/auradesk/src/windows/mod.rs`
- Create: `crates/auradesk/tests/close_does_not_exit.rs` (integration test)

**Interfaces:**
- Consumes: Task 4 (`auradesk_core::infrastructure::db::Db`)
- Produces: a Tauri 2 binary that, when launched, opens a window titled "AuraDesk" and registers a tray icon. Closing the window does **not** exit the process. Right-clicking the tray shows a menu with "Open" and "Quit". The "Quit" menu item exits the process cleanly. The integration test asserts: window close does not kill the process; tray icon is present; "Quit" ends the process.

- [ ] **Step 1: Write the failing integration test (`tests/close_does_not_exit.rs`).**

  Use Tauri's `MockRuntime` or a `tauri::test::mock_app` pattern. Three assertions:
  - After `app.run(...)` enters the main loop and a window is closed, the process is still running (the tray handler is still registered). Implement this with a `tauri::test::mock_builder()` and a closure on the `RunEvent::WindowEvent` that records the close.
  - The tray icon is in the app's tray set.
  - A `RunEvent::ExitRequested { code, api }` is **not** triggered by a window close (only by an explicit Quit menu).

  This test is integration and runs only on Linux (where WebKitGTK is available). Guard with `#[cfg(target_os = "linux")]`.

- [ ] **Step 2: Update `crates/auradesk/Cargo.toml` with Tauri + plugin deps.**

  Pin exact minor versions. As of this plan date, use `tauri = "2.1"`, `tauri-build = "2.0"`, `tauri-plugin-system-tray = "2.0"`. Add `[build-dependencies] tauri-build = "2.0"`. Add a `default-run = "auradesk"` to the workspace `Cargo.toml` so `cargo run` picks the right binary.

- [ ] **Step 3: Create `tauri.conf.json`.**

  ```json
  {
    "$schema": "https://schema.tauri.app/config/2.0.0",
    "productName": "AuraDesk",
    "version": "0.1.0",
    "identifier": "com.ragton.auradesk",
    "build": {
      "beforeDevCommand": "pnpm --filter @auradesk/web dev",
      "beforeBuildCommand": "pnpm --filter @auradesk/web build",
      "devUrl": "http://localhost:5173",
      "frontendDist": "../apps/web/dist"
    },
    "app": {
      "windows": [
        { "title": "AuraDesk", "width": 1200, "height": 800 }
      ],
      "security": { "csp": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'" },
      "trayIcon": { "iconPath": "icons/32x32.png" }
    }
  }
  ```

- [ ] **Step 4: Create `build.rs`.**

  `fn main() { tauri_build::build() }`.

- [ ] **Step 5: Create `capabilities/default.json`.**

  Minimal: `{"identifier":"default","description":"AuraDesk default capability","windows":["main"],"permissions":["core:default"]}`. Phase 1+ will add more permissions as the IPC surface grows.

- [ ] **Step 6: Create placeholder icons.**

  Three solid-color PNGs of the required dimensions. They are placeholders; a designer-supplied set replaces them in Phase 5.

- [ ] **Step 7: Implement `main.rs`.**

  Subcommand dispatch: `auradesk` (default) launches the Tauri app; `auradesk mcp` launches the MCP server (Task 6). Use `std::env::args()` to read the subcommand.

- [ ] **Step 8: Implement `runtime.rs` to wire tracing + tokio + the Tauri builder.**

  Tracing init (`tracing_subscriber::fmt`), the Tauri builder, the window setup, the tray menu (Open + Quit), the close-to-tray behavior, and the `RunEvent::ExitRequested` handler that only honors explicit quits.

- [ ] **Step 9: Implement the placeholder `ipc/mod.rs`, `tray/mod.rs`, `windows/mod.rs`.**

  Each is a module file with a doc comment and a `// Phase 1+` note. No real commands yet.

- [ ] **Step 10: Run the test (RED then GREEN).**

  Run: `cargo test -p auradesk --test close_does_not_exit`
  Expected: the test fails before the implementation, passes after. Use `tauri::test::mock_app` and assert on the recorded close event without a process exit.

- [ ] **Step 11: Run `cargo clippy -p auradesk --all-targets -- -D warnings`.**

  Expected: clean.

- [ ] **Step 12: Run `cargo run -p auradesk` manually.**

  Expected: a window appears with the title "AuraDesk" and a tray icon. Closing the window hides it; the process is still running. Right-click the tray; "Open" shows the window; "Quit" exits. If any of these fail, fix before committing.

- [ ] **Step 13: Commit.**

  ```bash
  git add crates/auradesk/
  git commit -m "feat(auradesk): Tauri 2 app with Hello window + system tray + close-to-tray"
  ```

**Gate:** `cargo run -p auradesk` opens the window, the tray works, closing the window does not exit. The integration test passes.

---

### Task 6: auradesk-mcp — stdio server with `initialize` + empty `tools/list`

**Files:**
- Create: `crates/auradesk-mcp/Cargo.toml` (modify; add rmcp + tokio)
- Create: `crates/auradesk-mcp/src/main.rs`
- Create: `crates/auradesk-mcp/src/server.rs`
- Create: `crates/auradesk-mcp/src/errors.rs`
- Create: `crates/auradesk-mcp/tests/jsonrpc_smoke.rs`

**Interfaces:**
- Consumes: Task 4 (`auradesk_core::capabilities::capabilities()`)
- Produces: a stdio JSON-RPC server that answers `initialize` (with `serverInfo` and `capabilities`) and `tools/list` (with an empty array, since the capability registry is empty in Phase 0). The server writes **only** valid JSON-RPC messages to stdout. It does not write logs, banners, or anything else to stdout.

- [ ] **Step 1: Write the failing JSON-RPC smoke test (`tests/jsonrpc_smoke.rs`).**

  Two cases:
  - `initialize_returns_server_info`: spawn the binary with `auradesk mcp` as argv, write `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-28","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}` to stdin, close stdin, read stdout, assert the response is valid JSON-RPC and contains `result.serverInfo.name = "auradesk-mcp"`.
  - `tools_list_is_empty_when_no_capabilities`: write a `tools/list` request, assert the response is `{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}`.
  - `unknown_method_returns_minus_32601`: write `{"jsonrpc":"2.0","id":3,"method":"nope"}`, assert the response has `error.code = -32601`.
  - `stdout_contains_no_non_json_lines`: capture stdout as bytes; split by `\n`; for each non-empty line, parse as JSON; assert every line is either empty or parses as a JSON object starting with `{"jsonrpc":`. (This is the "stdout purity" guarantee — see Review Focus #2.)

- [ ] **Step 2: Update `crates/auradesk-mcp/Cargo.toml` with rmcp + tokio.**

  Pin rmcp to the same minor the spec uses; on `0.3.x` is fine. Add `tokio = { version = "1", features = ["rt-multi-thread", "macros", "io-util", "process", "sync", "time"] }`. Add `tracing = "0.1"`, `tracing-subscriber = { version = "0.3", features = ["env-filter"] }`.

- [ ] **Step 3: Implement `server.rs` with rmcp's stdio transport.**

  The server registers the capability registry (currently empty) and answers the standard methods. The `initialize` response includes `serverInfo: { name: "auradesk-mcp", version: env!("CARGO_PKG_VERSION") }` and an empty `capabilities` object (Phase 0; tools/capabilities are added in Phase 1+).

- [ ] **Step 4: Implement `errors.rs` to map `CoreError` to JSON-RPC codes.**

  Use the mapping in spec §8.6. This file is also a contract that Phase 0 cannot violate: the test `unknown_method_returns_minus_32601` is the first check.

- [ ] **Step 5: Implement `main.rs` to set up tracing to stderr and start the server.**

  Tracing is configured with `with_writer(std::io::stderr)` so logs never reach stdout.

- [ ] **Step 6: Run the tests.**

  Run: `cargo test -p auradesk-mcp`
  Expected: 4 tests pass.

- [ ] **Step 7: Manual smoke from the shell.**

  Run: `cargo build -p auradesk --release && echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | ./target/release/auradesk mcp`
  Expected: stdout contains a single JSON line `{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}` and nothing else.

- [ ] **Step 8: Commit.**

  ```bash
  git add crates/auradesk-mcp/
  git commit -m "feat(mcp): stdio JSON-RPC server with initialize + empty tools/list"
  ```

**Gate:** the four smoke tests pass; the manual `tools/list` round-trip returns `{"tools":[]}` on stdout and nothing else.

---

### Task 7: Frontend — Vite + React + TS + Tailwind v4 + shadcn config + i18n

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/postcss.config.js`
- Create: `apps/web/components.json`
- Create: `apps/web/index.html`
- Create: `apps/web/locales/pt-BR.json`
- Create: `apps/web/locales/en.json`
- Create: `apps/web/public/sounds/.gitkeep` (empty dir, sounds come in Phase 2)
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/router.tsx`
- Create: `apps/web/src/app/layout/AppShell.tsx`
- Create: `apps/web/src/lib/ipc.ts`
- Create: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/lib/utils.ts`
- Create: `apps/web/src/styles/globals.css`
- Create: `apps/web/.gitignore`

**Interfaces:**
- Consumes: Task 1 (Node available in devShell), Task 5 (`tauri.conf.json` pointing at `apps/web/dist`)
- Produces: a `pnpm install`able app that builds with `pnpm tauri build` and runs in dev with `pnpm tauri dev`. The i18n catalog has `pt-BR` and `en`. The `AppShell` is a single page that says "AuraDesk" and the current locale.

- [ ] **Step 1: Write the failing i18n round-trip test.**

  Add `apps/web/vitest.config.ts` and a `src/lib/i18n.test.ts` that:
  - Loads `i18n` with `lng: 'pt-BR'`, asserts `i18n.t('app.title')` equals the value in `locales/pt-BR.json`.
  - Switches to `lng: 'en'`, asserts `i18n.t('app.title')` equals the value in `locales/en.json`.

  Both `locales/*.json` are seeded with one key, `app.title`, in the next step.

- [ ] **Step 2: Create `apps/web/package.json`.**

  Name `@auradesk/web`, private, type `module`, scripts: `dev`, `build`, `preview`, `lint`, `test`, `typecheck`. Deps: `react`, `react-dom`, `react-router-dom`, `zustand`, `i18next`, `react-i18next`, `i18next-browser-languagedetector`, `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`. DevDeps: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `autoprefixer`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `eslint`, `prettier`, `eslint-config-prettier`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`.

- [ ] **Step 3: Create the Vite, TS, Tailwind, PostCSS configs.**

  Vite: minimal `@vitejs/plugin-react` config; `resolve.alias` for `@/` → `src/`; `server.port = 5173`; `server.strictPort = true` (so the Tauri devUrl `http://localhost:5173` always resolves).

  tsconfig: extends `../../tsconfig.base.json`; sets `baseUrl` and `paths` for the `@/` alias.

  Tailwind v4: uses `@tailwindcss/postcss` in `postcss.config.js`; `globals.css` starts with `@import "tailwindcss";`.

  PostCSS: `{ plugins: { '@tailwindcss/postcss': {}, autoprefixer: {} } }`.

- [ ] **Step 4: Create `index.html`.**

  Standard Vite + React entry. Title "AuraDesk".

- [ ] **Step 5: Create the two locale files with the seed key.**

  `locales/pt-BR.json`: `{"app":{"title":"AuraDesk"}}`
  `locales/en.json`: `{"app":{"title":"AuraDesk"}}`

- [ ] **Step 6: Implement `src/lib/i18n.ts` and `src/lib/utils.ts`.**

  i18n: `i18next` + `react-i18next` + `i18next-browser-languagedetector`, with `fallbackLng: 'pt-BR'`, `supportedLngs: ['pt-BR', 'en']`.

  utils: `cn(...inputs)` for class names; uses `clsx` + `tailwind-merge`.

- [ ] **Step 7: Implement `src/lib/ipc.ts` as a stub.**

  A typed wrapper around `tauri::invoke`. Phase 0 exposes only a `ping()` that returns `"pong"`. The `apps/web/src/lib/ipc.ts` file uses `@tauri-apps/api/core` `invoke('ping')`.

- [ ] **Step 8: Implement `src/main.tsx`, `src/app/router.tsx`, `src/app/layout/AppShell.tsx`.**

  `main.tsx` mounts `<App />` inside `<I18nextProvider>`. `App` is a router with one route: `/` → `AppShell`. `AppShell` is a centered "AuraDesk" heading and a locale switcher (two buttons: `pt-BR`, `en`).

- [ ] **Step 9: Create `components.json` for shadcn (initialized but no components yet).**

  ```json
  { "$schema": "https://ui.shadcn.com/schema.json", "style": "new-york", "rsc": false, "tsx": true, "tailwind": { "config": "tailwind.config.ts", "css": "src/styles/globals.css", "baseColor": "slate", "cssVariables": true }, "aliases": { "components": "@/components", "utils": "@/lib/utils" } }
  ```

- [ ] **Step 10: `pnpm install` at the root.**

  Run: `pnpm install`
  Expected: pnpm resolves the workspace, installs all deps, no errors. A `pnpm-lock.yaml` is created at the repo root. **Commit this lockfile** (don't add it to `.gitignore`).

- [ ] **Step 11: Run the i18n test (GREEN).**

  Run: `pnpm --filter @auradesk/web test`
  Expected: 1 test passes (the round-trip).

- [ ] **Step 12: Run `pnpm typecheck` and `pnpm lint`.**

  Expected: clean.

- [ ] **Step 13: Run `pnpm tauri dev` (this requires Task 5's `tauri.conf.json` to point at `apps/web` correctly).**

  Expected: a Tauri window opens showing the "AuraDesk" heading and the locale switcher; switching the locale changes the document title (or other visible text) to match.

- [ ] **Step 14: Commit.**

  ```bash
  git add apps/web/ pnpm-lock.yaml
  git commit -m "feat(web): Vite + React + TS + Tailwind v4 + i18n (pt-BR, en) with locale switcher"
  ```

**Gate:** `pnpm install` succeeds; `pnpm tauri dev` opens the Tauri window with the React app; the i18n test passes; `pnpm typecheck` and `pnpm lint` are clean.

---

### Task 8: SettingsKey enum + i18n init in core + `bin/check-strings`

**Files:**
- Create: `crates/auradesk-core/src/application/settings.rs` (with `SettingsKey` enum)
- Create: `crates/auradesk-core/src/domain/settings_key.rs`
- Modify: `crates/auradesk-core/src/lib.rs` (re-export)
- Modify: `crates/auradesk-core/src/i18n.rs` (call `set_locale` from a config)
- Create: `crates/auradesk/bin/check-strings.rs`
- Create: `crates/auradesk-core/Cargo.toml` (add `[[bin]]` entry)
- Create: `scripts/check-strings.sh` (wrapper)

**Interfaces:**
- Consumes: Task 4, Task 6
- Produces: a `SettingsKey` enum with 16 variants matching the seeded keys; `SettingsService::get(key: SettingsKey) -> Result<JsonValue, CoreError>`; a `set(key: SettingsKey, value: JsonValue) -> Result<(), CoreError>` that rejects unknown keys; the `bin/check-strings` binary that scans the source tree for hard-coded user-facing strings and exits non-zero on violations; a wrapper script `scripts/check-strings.sh` that invokes the same logic in Node (for the frontend tree).

- [ ] **Step 1: Write the failing test for `SettingsKey` validation.**

  In `crates/auradesk-core/tests/settings_key.rs`:
  - `set_unknown_key_returns_validation_error`: open a temp DB, call `set` with a key not in the enum (e.g., a typo `pomodoro.focus_minn`); expect `CoreError::Validation`.
  - `set_then_get_roundtrip`: set `SettingsKey::AppLocale` to `"en"`, then `get` returns `"en"`.
  - `get_returns_seeded_default`: open a fresh DB (already seeded with 16 rows by Task 4), `get(SettingsKey::MonitorPreferred)` returns `"primary"`.

- [ ] **Step 2: Implement `SettingsKey` enum in `domain/settings_key.rs`.**

  Sixteen variants, one per seeded key (see spec §7.3):
  `AppVersion, AppTheme, AppLocale, DashboardRefreshSec, MonitorPreferred, MonitorFallbackStrategy, RemindersSound, RemindersPausedUntil, PomodoroFocusMin, PomodoroShortMin, PomodoroLongMin, PomodoroCyclesToLong, RoutineDailyPlanningTime, RoutineWaterIntervalMin, RoutineBreakIntervalMin, AlertsMaxQueueSize, ProposalsTtlHours`.

  Methods:
  - `as_key(&self) -> &'static str` (e.g., `AppLocale.as_key() == "app.locale"`).
  - `from_key(s: &str) -> Option<Self>` (returns `None` for unknown keys).

- [ ] **Step 3: Implement `SettingsService` in `application/settings.rs`.**

  - `pub fn get(&self, conn: &Connection, key: SettingsKey) -> Result<JsonValue, CoreError>` — read the row by `as_key`, parse the value as `JsonValue`, return it.
  - `pub fn set(&self, conn: &mut Connection, key: SettingsKey, value: JsonValue) -> Result<(), CoreError>` — UPSERT into `settings`. The `set` does **not** need to check the enum against the key (the type system already ensures that). It does, however, validate that the value matches the expected type (e.g., `PomodoroFocusMin` must be a positive integer). Validation is done with a separate `validate(key, value) -> Result<(), CoreError>` function.

- [ ] **Step 4: Run the tests (GREEN).**

  Run: `cargo test -p auradesk-core --test settings_key`
  Expected: 3 tests pass.

- [ ] **Step 5: Create `crates/auradesk/bin/check-strings.rs`.**

  The script:
  - Walks the source tree under `apps/web/src` (regex-based file enumeration; **no** `walkdir` dep).
  - For each `.ts`, `.tsx`, `.js`, `.jsx` file, runs a set of regexes that match hard-coded user-facing strings. The allow-list is inline in the source:
    - Whitelist: lines containing `aria-`, `data-testid`, `// i18n-allow`, `import.*from`, `console.`, `process.env`, `localStorage`, `URL`, `navigator`, `new Date`, `throw new Error`, regex char-classes.
    - Block: a JSX text node that contains 2+ non-whitespace ASCII characters and is not inside a `{t('...')}` call. Detect by parsing line-by-line with a state machine (no JSX parser dep).
  - Exits 0 if no violations; non-zero with a per-file report otherwise.
  - Runs in <1s on a small tree; the test below asserts this.

- [ ] **Step 6: Create the wrapper `scripts/check-strings.sh`.**

  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  cargo run --quiet --bin check-strings -- "$@"
  ```

  Plus a `pnpm`-side script in the root `package.json` (`"check-strings": "bash scripts/check-strings.sh"`) so CI can call `pnpm check-strings`.

- [ ] **Step 7: Add the `[[bin]]` entry in `crates/auradesk-core/Cargo.toml`.**

  ```toml
  [[bin]]
  name = "check-strings"
  path = "bin/check-strings.rs"
  ```

- [ ] **Step 8: Smoke test the binary.**

  Run:
  - `cargo build --bin check-strings`
  - `cargo run --bin check-strings` (should exit 0 on the current tree)
  - Then temporarily insert `// i18n-violation: "hello world"` into `apps/web/src/main.tsx`, run again, expect non-zero exit with a message naming the file and the offending line. Revert the line.

- [ ] **Step 9: Commit.**

  ```bash
  git add crates/auradesk-core/src/application/settings.rs crates/auradesk-core/src/domain/settings_key.rs crates/auradesk-core/src/lib.rs crates/auradesk-core/src/i18n.rs crates/auradesk-core/bin/ crates/auradesk-core/Cargo.toml scripts/check-strings.sh
  git commit -m "feat(core): SettingsKey enum + SettingsService + bin/check-strings enforcement"
  ```

**Gate:** all 3 settings tests pass; `cargo run --bin check-strings` exits 0 on the current tree; inserting a violation makes it exit non-zero; reverting makes it exit 0 again.

---

### Task 9: Capability registry smoke test

**Files:**
- Modify: `crates/auradesk-core/src/capabilities.rs` (no behavior change; the registry is still empty in Phase 0)
- Create: `crates/auradesk-core/tests/capabilities_consistent.rs`

**Interfaces:**
- Consumes: Task 8
- Produces: a test that asserts the capability registry in `auradesk-core` and the binary's view of it agree. In Phase 0 the registry is empty; the test asserts `(a)` the registry returns `&[]`, `(b)` the empty registry is the same when queried from the `auradesk-mcp` binary (via the `tools/list` response).

- [ ] **Step 1: Write the failing test (`tests/capabilities_consistent.rs`).**

  The test:
  - Calls `auradesk_core::capabilities::capabilities()` and asserts the length is 0.
  - Asserts that the unique names of the capabilities are sorted alphabetically (a future invariant).

  In Phase 0 this is a trivial test; in Phase 1+ it grows as the registry grows. The test ensures that the alphabetical invariant is established **before** there is anything to sort.

- [ ] **Step 2: Implement the test.**

  Use `rstest` for fixtures. No additional production code; this is a `tests/` file.

- [ ] **Step 3: Run the test (GREEN).**

  Run: `cargo test -p auradesk-core --test capabilities_consistent`
  Expected: 2 tests pass.

- [ ] **Step 4: Commit.**

  ```bash
  git add crates/auradesk-core/tests/capabilities_consistent.rs
  git commit -m "test(core): capability registry consistency smoke test (alphabetical invariant)"
  ```

**Gate:** the test passes; documented as a future-proofing hook for Phase 1+.

---

### Task 10: CI workflows (Linux + Windows)

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: all earlier tasks
- Produces: a CI workflow that runs on every push and PR, on `ubuntu-latest` and `windows-latest`, executing the Phase 0 gate. A release workflow that triggers on `v*.*.*` tags and builds a Tauri bundle via `tauri-action`.

- [ ] **Step 1: Write the failing pre-flight check.**

  Open `.github/workflows/` and confirm there is no `ci.yml` (the test is "this file must exist and be valid YAML").

- [ ] **Step 2: Create `ci.yml`.**

  Top-level `name: ci`, `on: [push, pull_request]`, `jobs:` with two entries (`linux` and `windows`).

  Linux job:
  - `runs-on: ubuntu-latest`
  - Steps: checkout, install Rust (`dtolnay/rust-toolchain@stable`), cache Cargo, install Node 22, install pnpm, cache pnpm, install Linux system deps (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libsoup-3.0-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev` — the standard Tauri Linux dependency list), `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace --locked`, `pnpm install --frozen-lockfile`, `pnpm --filter @auradesk/web lint`, `pnpm --filter @auradesk/web test`, `pnpm --filter @auradesk/web typecheck`, `pnpm check-strings`, `pnpm tauri build --bundles appimage deb`.

  Windows job:
  - `runs-on: windows-latest`
  - Steps: checkout, install Rust (windows-msvc), install Node 22, install pnpm, cache, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace --locked`, `pnpm install --frozen-lockfile`, `pnpm --filter @auradesk/web lint`, `pnpm --filter @auradesk/web test`, `pnpm --filter @auradesk/web typecheck`, `pnpm check-strings`. (No `tauri build` on Windows in this PR — the Windows bundle is verified in a separate workflow that has more time; the spec's `11.1` gate is split.)

- [ ] **Step 3: Create `release.yml`.**

  Trigger on `push: tags: ['v*.*.*']`. One job on `ubuntu-latest` (Linux AppImage and .deb) and one on `windows-latest` (NSIS .msi). Uses `tauri-apps/tauri-action` for the build and `softprops/action-gh-release` for the GitHub release. **The release job uses Azure Trusted Signing (ADR-0010); the secrets are `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_CODE_SIGNING_ACCOUNT`, `AZURE_CODE_SIGNING_PROFILE`.** Until those secrets are configured in the repository, the release workflow will fail at the signing step; document this in a `docs/release.md` so the owner knows what to set.

- [ ] **Step 4: Verify the workflows parse.**

  The test: open the GitHub UI (or use `act` locally) to confirm there is no YAML syntax error. `act` is not installed and the user forbade installing it; the verification is done by the GitHub UI on the first push. **The plan is satisfied by the YAML being well-formed, not by a local run.**

- [ ] **Step 5: Commit.**

  ```bash
  git add .github/workflows/
  git commit -m "build(ci): GitHub Actions for Linux + Windows with Tauri release workflow"
  ```

**Gate:** the workflows are well-formed YAML; on the first push to a branch, GitHub Actions reports a green check for both jobs (verified by the GitHub UI, not by a local run).

---

### Task 11: Phase 0 gate verification + final commit

**Files:**
- Modify: `README.md` ("Status" section)
- Modify: `docs/architecture/README.md` (new — a single-page architecture pointer; see file list)

**Interfaces:**
- Consumes: all earlier tasks
- Produces: a README that says "Phase 0 complete" and a `docs/architecture/README.md` that points at the spec, the plan, the ADRs, and the audit, with one diagram reused from the spec.

- [ ] **Step 1: Run the entire Phase 0 gate end-to-end (locally, on Linux).**

  - `nix develop --command cargo fmt --all -- --check` → exit 0
  - `nix develop --command cargo clippy --workspace --all-targets -- -D warnings` → exit 0
  - `nix develop --command cargo test --workspace` → all tests pass
  - `nix develop --command cargo build --release -p auradesk` → binary produced at `target/release/auradesk`
  - `nix develop --command cargo run --release -p auradesk -- mcp` (in one terminal) and in another: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | nc -U <socket>` (or whatever transport Phase 0 uses — Phase 0 is stdio so a simple pipe works). Expected: `{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}`.
  - `nix develop --command pnpm install --frozen-lockfile` → exit 0
  - `nix develop --command pnpm --filter @auradesk/web typecheck` → exit 0
  - `nix develop --command pnpm --filter @auradesk/web lint` → exit 0
  - `nix develop --command pnpm --filter @auradesk/web test` → exit 0
  - `nix develop --command pnpm check-strings` → exit 0
  - `nix develop --command pnpm tauri build` → AppImage and .deb in `src-tauri/target/release/bundle/`

  If any step fails, fix and re-run. Do **not** mark the task done with failures.

- [ ] **Step 2: Update `README.md` "Status" section.**

  Change "Pre-implementation planning phase" to "Phase 0 — Foundation complete. Phases 1–5 in planning. See `docs/superpowers/plans/2026-10-16-auradesk-foundation.md` for the next steps."

- [ ] **Step 3: Create `docs/architecture/README.md`.**

  A single page that points at:
  - The MVP spec (`docs/superpowers/specs/2026-10-16-auradesk-mvp-design.md`).
  - The foundation plan (`docs/superpowers/plans/2026-10-16-auradesk-foundation.md`).
  - The ADRs (`docs/decisions/`).
  - The dependency audit (`docs/licensing/dependency-license-audit.md`).
  - One embedded Mermaid diagram reused verbatim from the spec §4.1 (the system diagram).

- [ ] **Step 4: Commit and push.**

  ```bash
  git add README.md docs/architecture/
  git commit -m "docs: Phase 0 status + architecture pointer"
  git push origin main
  ```

  Expected: the commit lands on `main`; CI runs Tasks 10's workflows (which were already pushed in Task 10) and they go green.

- [ ] **Step 5: Verify the CI workflows are green on `main`.**

  Open the GitHub UI; check the Actions tab. The `ci.yml` workflow should be green for the `linux` and `windows` jobs. If they are not, the Phase 0 gate is not yet satisfied; do not declare done.

**Gate:** all 10 local commands in Step 1 pass; the GitHub Actions `ci.yml` is green on `main`; the README status reflects "Phase 0 complete".

---

## Cross-cutting checks (run before declaring Phase 0 complete)

These checks verify that the plan's own pre-conditions hold at the end of Phase 0. They are run **after** Task 11 commits and the CI is green.

- [ ] **No `TODO` / `FIXME` / `XXX` / `TBD` in source code.** (Documentation may still contain "TBD" in the `PENDING_LICENSE_NOTICE.md`; that is intentional.) Run: `grep -nE "(TODO|FIXME|XXX|TBD)" crates/*/src apps/web/src 2>/dev/null` → no hits.
- [ ] **No new directory in the repo root is uncommitted.** Run: `git status --porcelain` → empty.
- [ ] **`pnpm check-strings` still passes after the final commit.** Confirms the "no hard-coded user-facing strings" invariant survives the README update.
- [ ] **`cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets -- -D warnings` are still clean** after the final commit.
- [ ] **The `LICENSE` file's SHA-256 is still `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`** (it must not have been modified accidentally).
- [ ] **`PENDING_LICENSE_NOTICE.md` is still present** and has not been resolved (i.e., still says "Status: OPEN").
- [ ] **The `git log` shows one Conventional Commit per task** (Tasks 0, 1, 2, …, 11), no fix-up commits in the middle.

## Out of scope for Phase 0 (explicit YAGNI)

These are not in the plan. The user said "não implementar funcionalidades"; these are listed so the engineer does not drift into them.

- No business logic (tasks, reminders, projects). The Tauri IPC layer is a placeholder; the first real Tauri command is added in Phase 1.
- No MCP tool beyond the empty `tools/list`. The first `propose_create_task` is added in Phase 2.
- No scheduler, no `daily_plans` table queries, no pomodoro.
- No real sound files, no real icons, no theme switcher UI.
- No CI caching, no matrix builds, no `act` local runs. The CI as defined runs only on push and PR; caching is added when the cold build is slow enough to warrant it.
- No Hermes, no Ollama, no LLM integration. Phase 0 is the floor.
- No CLA, no contribution flow. The freeze is documented and observed; the CLA is a separate work item.
- No `NOTICE` file. The dependency audit does not surface a NOTICE obligation in Phase 0; introducing one would be premature.
- No private/corporate identity in the `LICENSE` file. The placeholder is preserved; resolution is the owner's call.
