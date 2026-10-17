# ADR-007: i18n-ready from day 1 (validated by `bin/check-strings`)

**Status:** Accepted
**Date:** 2026-10-16
**Updated:** 2026-10-17

## Context

The user requested i18n-ready localization from the start. We need to
decide:

- Which libraries.
- Which locales ship with MVP.
- How new strings enter the codebase (linting).

The original ADR proposed a "custom clippy lint" to flag hard-coded
user-facing strings. After the 2026-10-17 critical review we replaced
that with a simpler and more auditable approach: a `bin/check-strings`
script that greps the source tree for hard-coded user-facing strings
and exits non-zero on violations. CI runs it on every push.

## Decision

- **Frontend:** `react-i18next` + `i18next`. Keys live in
  `apps/web/locales/<locale>.json`. The user's preferred locale is read
  from settings (`app.locale`) and applied at boot.
- **Backend:** `rust-i18n` crate. Keys live in
  `crates/auradesk-core/locales/<locale>.json`. Used in error messages
  and log output.
- **MVP locales:** `pt-BR` (default) and `en`. Both files ship from
  day 1; nothing in the codebase contains hard-coded user-facing
  Portuguese (or English) outside the locale files.
- **Validation:** `crates/auradesk/bin/check-strings.rs` is a small
  Rust binary (also runnable as `cargo run --bin check-strings`) that
  walks the source tree and applies a series of regex patterns to flag
  hard-coded user-facing strings. Allowed contexts are whitelisted:
  - `aria-*`, `data-*`, `title=` (HTML attributes)
  - Log lines (anything inside `tracing::info!`, `tracing::error!`, etc.)
  - Test assertions
  - The locale files themselves
  CI runs `pnpm check-strings` (the same script) and fails the build
  on any violation.

## Consequences

Positive:
- No refactor later when adding `en` or other locales.
- Translation memory is preserved from the first commit.
- Pseudoloc testing is trivial (swap locale file).
- The check is a simple, auditable script, not a custom Rust lint.
  Anyone can read the regex list and understand the policy.

Negative:
- ~5% overhead in initial setup (locale files, check script).
- Slightly more verbose components (every label is a key). Mitigated
  by VS Code/Neovim i18n extensions.
- The check is regex-based; it can have false positives (e.g., a log
  message that happens to contain a quoted string). We maintain an
  allow-list file to silence those cases and keep the signal-to-noise
  ratio high.
