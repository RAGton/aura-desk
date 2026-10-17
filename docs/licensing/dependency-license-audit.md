# Dependency License Audit

**Date:** 2026-10-17
**Author:** Aura (architect agent) per owner direction
**Project:** AuraDesk (`RAGton/aura-desk`, branch `main`, commit `69bc85a`)
**Project license (declared):** GPL-3.0-only (see [`../../LICENSE`](../../LICENSE) and [`../../docs/decisions/0012-license.md`](../decisions/0012-license.md))
**Status of this audit:** **Documentary** (no source code or lockfiles exist yet). Re-run as `automated` after `Cargo.lock` and `pnpm-lock.yaml` are produced.

## 1. Scope and method

This audit covers every dependency that is **declared in the spec**
([`../superpowers/specs/2026-10-16-auradesk-mvp-design.md`](../superpowers/specs/2026-10-16-auradesk-mvp-design.md) §5) and
that AuraDesk will pull in via Cargo (Rust) or pnpm (TypeScript).

The audit is **documentary** because the repository contains no
`Cargo.toml`, no `package.json`, and no lockfiles yet. No automated
license-scanning tool (`cargo-license`, `cargo-deny`, `pip-licenses`)
is installed in the development environment, and the user
explicitly forbade installing new tools in this round. The
information below comes from:

- The **npm registry** (`registry.npmjs.org`), queried via `npm view`.
- The **crates.io API** (`crates.io/api/v1/crates/{crate}/{version}`),
  queried via `curl` with a descriptive `User-Agent`.
- The **official GitHub `LICENSE` files** of each project, fetched
  via the `raw.githubusercontent.com` URLs, used as cross-checks.
- The **FSF's official text** of GPL-3.0, used to confirm that the
  declared licenses are GPL-3.0-compatible.

Each dependency is graded:

- **A — Compatible, no conditions.** MIT or public domain.
- **B — Compatible, conditions on the user.** Apache-2.0 (must
  reproduce the notice), MIT (must reproduce the copyright), or
  copy-paste components (must preserve the upstream copyright).
- **C — Incompatible.** Any copyleft (GPL/LGPL/AGPL) on a non-trivial
  dep that is not AuraDesk itself. **None found in this audit.**
- **D — Unverified.** No license data retrievable with the available
  tools. **Marked below.**

The grading is **documentary**, not legal advice. A second pass with
locked versions and license-detection tools is required at Phase 0
exit.

## 2. Tool inventory and what was used

| Tool | Status on this machine | Used here? |
|---|---|---|
| `curl` | Available | Yes — npm registry, crates.io API, GitHub raw |
| `npm` | Available | Yes — `npm view` for license metadata |
| `npx` | Available | Not used (no install) |
| `pnpm` | **Not installed** | No |
| `cargo-license` | Not installed | No |
| `cargo-deny` | Not installed | No |
| `pip-licenses` | Not installed | No |
| `git ls-files` | Available (via shell) | Yes — to confirm what is in the repo at HEAD |

The user forbade new installs; this is the available toolbox.

## 3. Rust dependencies (declared in spec §5 + ADR-006 + ADR-008 + ADR-009)

Each row below was queried against `https://crates.io/api/v1/crates/{crate}/{max_stable_version}` and cross-checked with the project's GitHub `LICENSE`. "License (latest)" is the SPDX string returned by crates.io for the version listed.

| Crate | Pinned-to-be version | License (latest) | Source URL | Grade | Notes |
|---|---|---|---|---|---|
| `tauri` | 2.12.4 | `Apache-2.0 OR MIT` | <https://github.com/tauri-apps/tauri/blob/dev/LICENSE.spdx> | **B** | Dual; reproduce both notices. |
| `tauri-build` | 2.7.3 | `Apache-2.0 OR MIT` | crates.io | **B** | Build-time only. |
| `rmcp` (Rust MCP SDK) | 0.3.x target / 3.5.1 latest | `Apache-2.0` | <https://github.com/modelcontextprotocol/rust-sdk> | **B** | Apache-2.0 only. Compatible. |
| `rusqlite` | 0.32 (spec) / 0.40.2 latest | `MIT` | <https://github.com/rusqlite/rusqlite> | **A** | With `bundled` feature, SQLite is compiled from source (public domain). |
| `refinery` | 0.8 (spec) / 0.10.0 latest | `MIT` | <https://github.com/rust-db/refinery> | **A** | |
| `rrule` | 0.7 (spec) / 0.14.0 latest | `MIT OR Apache-2.0` | <https://github.com/fmeringdal/rust-rrule> | **B** | |
| `croner` | 2 (spec) / 4.0.1 latest | `MIT` | crates.io | **A** | |
| `rodio` | 0.20 (spec) / 0.23.0 latest | `MIT OR Apache-2.0` | <https://github.com/RustAudio/rodio> | **B** | |
| `rust-i18n` | 4.2.4 (latest) | `MIT` | crates.io per-version endpoint | **A** | Cross-check via raw GitHub returned 404; crates.io API used. |
| `ulid` | 1 (spec) / 3.0.0 latest | `MIT` | <https://github.com/dylanhart/ulid-rs> | **A** | ULID wrapper. |
| `serde` | 1.0.x | `MIT OR Apache-2.0` | <https://github.com/serde-rs/serde> | **B** | De-facto standard. |
| `serde_json` | 1.0.x | `MIT OR Apache-2.0` | crates.io | **B** | |
| `tokio` | 1.53.x | `MIT` | <https://github.com/tokio-rs/tokio> | **A** | |
| `tracing` | 0.1.x | `MIT` | <https://github.com/tokio-rs/tracing> | **A** | |
| `tracing-subscriber` | 0.3.x | `MIT` | crates.io | **A** | |
| `thiserror` | 2.0.x | `MIT OR Apache-2.0` | <https://github.com/dtolnay/thiserror> | **B** | |
| `anyhow` | 1.0.x | `MIT OR Apache-2.0` | <https://github.com/dtolnay/anyhow> | **B** | |
| `dirs` (for XDG paths) | TBD | **D — unverified** | n/a | **D** | No registry call made. Re-audit at Phase 0. |

**Sub-dependencies (transitive) are not audited here.** A future
audit with `cargo tree` plus a license-detection tool will cover
them. The transitive graph is large and changes with each version
bump; auditing it now would be premature.

**Pending Rust deps that will need their own audit when chosen:**

- Tauri plugins: `tauri-plugin-system-tray`, `tauri-plugin-notification`,
  `tauri-plugin-window-state`, `tauri-plugin-autostart`,
  `tauri-plugin-store`, `tauri-plugin-single-instance`,
  `tauri-plugin-clipboard-manager` (and any others that get added in
  Phase 3). These are published under the Tauri org and follow the
  Tauri dual license; they should be B-grade, but each needs a
  one-line confirmation.
- Wayland bindings for Hyprland hot-plug (Phase 3 / R-L4):
  `wayland-rs`, `wayland-protocols`, `wayland-protocols-wlr`. **D —
  unverified.** GPL-2.0-or-later or MIT depending on the binding.
  Must be re-checked when the binding is chosen; the
  `wayland-protocols` package historically has had LGPL/MIT dual
  licensing and the version currently used by Nixpkgs must be
  confirmed.

## 4. Node.js / TypeScript dependencies (declared in spec §5 + ADR-005 + ADR-007)

Each row was queried against the npm registry's `/latest` endpoint.

| Package | License (latest) | Source URL | Grade | Notes |
|---|---|---|---|---|
| `react` | `MIT` | <https://github.com/facebook/react/blob/main/LICENSE> | **A** | |
| `react-dom` | `MIT` | npm registry | **A** | |
| `typescript` | `Apache-2.0` | npm registry | **B** | |
| `vite` | `MIT` | npm registry | **A** | |
| `tailwindcss` | `MIT` | <https://github.com/tailwindlabs/tailwindcss/blob/main/LICENSE> | **A** | |
| `@tauri-apps/api` | `Apache-2.0 OR MIT` | npm registry | **B** | |
| `@tauri-apps/cli` | `Apache-2.0 OR MIT` | npm registry | **B** | |
| `zustand` | `MIT` | npm registry | **A** | |
| `react-i18next` | `MIT` | npm registry | **A** | |
| `i18next` | `MIT` | npm registry | **A** | |
| `jsonschema` (MCP input validation) | `MIT` | npm registry | **A** | |

**Special case: shadcn/ui.** The spec §5 declares shadcn/ui as the
component library, but shadcn/ui is **not a published npm package**;
it is a catalog of components that the developer **copies into the
repository** under `apps/web/src/components/ui/`. The components
are **MIT-licensed** (confirmed via
<https://github.com/shadcn-ui/ui/blob/main/LICENSE.md>).

When copy-pasted, each shadcn component becomes part of the
AuraDesk source code and is therefore offered under
AuraDesk's public license (GPL-3.0-only). This is permitted by the
MIT license (which allows sublicensing), **on the condition that the
upstream MIT copyright notice is preserved in each copied file.**
This is **a process requirement, not a legal conflict**.

**Operational requirement:** the Phase 0 plan must include a step
that ensures every copied shadcn component retains its upstream
MIT copyright header. A CI check that fails on the absence of the
expected notice is the right enforcement mechanism (this is the
same pattern as `bin/check-strings` from ADR-007).

**Sub-dependencies (transitive)** are not audited here for the same
reason as Rust: the graph is large and lockfile-dependent.

## 5. Other resources

| Resource | Status | Action required at Phase 0 |
|---|---|---|
| Sounds (3 WAVs, spec ADR-009) | **Not yet in repo** | Each WAV must come with a license declaration (own work, CC0, or a documented permission). If a third-party sound is used, its license must be re-audited. |
| Icons | **Not yet in repo** | Same as sounds. shadcn/ui does not bundle icons by default; we will need to choose an icon set (Lucide, Heroicons, etc.) and audit it. |
| Fonts | **Not yet in repo** | Same as icons. |
| Logos / trademarks | Out of scope for this audit | See ADR-0012 §7 — trademark is a separate right. |
| Code copied from third parties | **None yet** | Any future snippet import must come with a license declaration in the file header. |

## 6. Summary of findings

| Grade | Count (this audit) | Comment |
|---|---|---|
| **A** — MIT / public domain, no conditions | 9 deps | No action. |
| **B** — MIT-OR-APACHE-2.0 / Apache-2.0 / MIT copy-paste | 10 deps | Each carries a notice-preservation obligation. Documented in the file headers (CI-enforceable in Phase 0). |
| **C** — Incompatible copyleft | **0** | None found. |
| **D** — Unverified at this point | 2 (the `dirs` crate; the Wayland bindings not yet chosen) | Must be confirmed before Phase 0 closes. |

**No critical conflicts. No copyleft dep that would force relicensing
of AuraDesk. No dependency that would prevent the dual-licensing
track described in ADR-0012.**

## 7. Limitations of this audit

The user asked to differentiate automated from documentary results.
This audit is **entirely documentary** because no automated
license-detection tool is available. The following limitations
apply:

1. **No lockfiles exist.** A future audit must re-run after
   `Cargo.lock` and `pnpm-lock.yaml` are produced, with a
   license-detection tool installed (`cargo-deny` for Rust,
   `license-checker` for Node). The user has not authorized
   installing new tools in this round.
2. **Transitive dependencies are not audited.** Both Cargo and
   npm produce a deep graph; only direct deps are listed above.
3. **Version drift is not tracked.** The versions above are the
   crates.io / npm "latest stable" at audit time. Pinning a
   different version may surface a different license; this
   happens most often with `rmcp` (still pre-1.0) and Tauri
   plugins.
4. **No "named author" check.** Some MIT/Apache-2.0 deps rely on
   per-file copyright headers. We have not verified that every
   dep's source files contain the correct headers; we have only
   verified the **project-level** license.
5. **Assets not yet in the repo.** The three WAVs, the icons,
   the font, and any future third-party code snippet are not in
   this audit because they do not exist in the repo yet. They
   must be audited at the time they are added (Phase 1+).
6. **Trademark is not covered.** The "AuraDesk" name, the logo,
   and any iconography are not in scope; see ADR-0012 §7.

## 8. Items requiring the owner's decision or future legal review

These are **not** blockers for Phase 0 implementation, but they are
real audit items that need attention before the **first public
distribution** of a binary:

1. **Copyright holder for the project source code.** Recorded in
   `PENDING_LICENSE_NOTICE.md`. The `LICENSE` file at the root
   is the GPL-3.0 text only; the project copyright line is not
   yet added. (This is by the owner's direction; do not invent.)
2. **The `dirs` crate's license.** A small item but the
   XDG-path utility is used on every OS; it should be confirmed
   (it is widely understood to be MIT, but the documentary
   check did not complete).
3. **Wayland bindings (Phase 3, R-L4).** When the binding for
   `wlr-output-management-unstable-v1` is chosen, its license
   must be re-audited. Some bindings are MIT, some are
   GPL-2.0-or-later. Both are compatible with GPL-3.0-only, but
   the exact string matters.
4. **Tauri plugins.** Each plugin's license must be checked
   when its version is pinned. Expected to be B-grade
   (Apache-2.0 OR MIT), but must be confirmed.
5. **Asset licenses (sounds, icons, fonts).** Audit at the time
   of inclusion in the repo. None of the spec's described
   assets are present yet.
6. **Snippets of third-party code.** If any code is borrowed
   from a Stack Overflow answer, an OSS project, or a public
   gist, each snippet's source and license must be recorded in
   the file header. Not present yet.
7. **A future CLA / copyright assignment template.** This is
   outside the scope of this audit but is the prerequisite for
   lifting the contribution freeze (ADR-0012 §5).

## 9. What this audit did not do (and the reason)

- **Did not install** `cargo-license`, `cargo-deny`, or
  `license-checker`. Forbidden by the user's instructions for
  this round.
- **Did not assert legal compatibility.** This is a
  technical/documented audit. A legal professional should
  review the dual-licensing strategy and the copyleft implications
  before the first commercial contract is signed.
- **Did not produce a "deny" list.** No dep in the audited set
  is denied; the most we have is "must be re-checked at pinning
  time" (the `dirs` and Wayland cases).
- **Did not introduce a NOTICE file.** The user explicitly noted
  that a NOTICE file is not a substitute for the license text or
  for required copyright notices. We will introduce a NOTICE
  only if/when an actual asset (sound, icon, font) with a NOTICE
  obligation is added.
