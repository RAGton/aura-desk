# ADR-007: i18n-ready from day 1

**Status:** Accepted
**Date:** 2026-10-16

## Context

The user requested i18n-ready localization from the start. We need to
decide:

- Which libraries.
- Which locales ship with MVP.
- How new strings enter the codebase (linting).

## Decision

- **Frontend:** `react-i18next` + `i18next`. Keys live in
  `apps/web/locales/<locale>.json`. The user's preferred locale is read
  from settings (`app.locale`) and applied at boot.
- **Backend:** `rust-i18n` crate. Keys live in
  `crates/auradesk-core/locales/<locale>.json`. Used in error messages
  and log output.
- **MVP locales:** `pt-BR` (default) and `en`. Both files ship from
  day 1; nothing in the codebase contains hard-coded user-facing
  Portuguese outside the locale files.
- **Linting:** an ESLint rule and a Rust `clippy` lint (custom) flag
  hard-coded user-facing strings in component/service files.

## Consequences

Positive:
- No refactor later when adding `en` or other locales.
- Translation memory is preserved from the first commit.
- Pseudoloc testing is trivial (swap locale file).

Negative:
- ~5% overhead in initial setup (locale files, lint config).
- Slightly more verbose components (every label is a key). Mitigated
  by VS Code/Neovim i18n extensions.
