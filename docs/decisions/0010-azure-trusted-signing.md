# ADR-010: Code signing via Azure Trusted Signing

**Status:** Accepted
**Date:** 2026-10-16

## Context

Windows users will see SmartScreen warnings on unsigned executables.
This damages trust and creates support overhead. Options:

- **Self-signed certificate**: free, but SmartScreen reputation is
  never established.
- **OV (Organization Validation) certificate**: ~$200/yr, builds
  reputation over time.
- **EV (Extended Validation) certificate**: ~$500/yr + hardware token,
  immediate SmartScreen trust.
- **Azure Trusted Signing**: ~$10/month, no hardware token, designed
  for cloud CI, builds reputation similarly to OV.

## Decision

Use **Azure Trusted Signing** in the GitHub Actions release workflow.
The signing secret is stored in the repo's GitHub Actions secrets; the
signing tool (`trusted-signing-cli`) runs in a CI step after `tauri
build`.

For MVP, we accept that SmartScreen may still show a warning until
reputation builds. We document this in the README.

## Consequences

Positive:
- Low cost (~$10/mo).
- No hardware token to manage.
- Designed for cloud CI workflows.
- Reputation builds over time as users install.

Negative:
- SmartScreen still warns on first install. Acceptable; documented.
- Tied to Azure. If the user migrates CI elsewhere, signing needs
  rework.
- Certificate lifetime is shorter than EV (~3 years vs 5+).
