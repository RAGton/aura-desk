# Contributing to AuraDesk

**Status:** Contribution freeze in effect. Last updated: 2026-10-17.
**Related documents:** [`docs/decisions/0012-license.md`](decisions/0012-license.md) ·
[`PENDING_LICENSE_NOTICE.md`](PENDING_LICENSE_NOTICE.md) ·
[`LICENSE`](LICENSE)

## Summary

**AuraDesk is not currently accepting external code contributions.**
This is a temporary measure. Issues, bug reports, security
disclosures, and feature requests are still welcome.

## Why the freeze

AuraDesk's public license is **GPL-3.0-only** (see
[`LICENSE`](LICENSE)). The owner also reserves the right to offer
alternative commercial terms to specific licensees (a "dual
licensing" track, recorded in
[ADR-0012](decisions/0012-license.md)).

For the dual-licensing track to be viable, the **copyright holder**
must own the copyright in every line of code distributed under the
alternative terms. A code contribution from an external contributor
**introduces copyright owned by that contributor**. Without an
explicit Contributor License Agreement (CLA) or copyright
assignment, the contributor's code cannot be re-licensed under the
commercial track.

Until a CLA is in place, accepting code contributions would either:

- **Risk the dual-licensing track.** Code whose copyright the owner
  does not fully control cannot be sold under commercial terms.
- **Be unfair to contributors.** Accepting a contribution without a
  CLA would create ambiguity about what the contributor agreed to.

Neither outcome is acceptable. The freeze is the conservative
response.

## What is still welcome

- **Bug reports.** Open an issue with a clear repro.
- **Feature requests.** Open an issue describing the use case and
  the desired behavior. No code required.
- **Security disclosures.** See the security policy (TBD) for the
  private reporting channel. Until that document exists, open a
  regular issue and mark it with a `security` label.
- **Documentation corrections** that can be made without code
  changes (typos, broken links, factual errors). These are not
  "contributions" in the copyright sense.
- **Translations** of UI strings once the i18n catalog exists (Phase
  1+ of the project). Translations are documentation, not code.

## What is NOT accepted right now

- Pull requests that include code (any language: Rust, TypeScript,
  SQL, Nix, shell, CI configuration that affects behavior).
- Patches sent via email, chat, or any channel other than the issue
  tracker. (We want all proposed changes to be public and
  reviewable.)
- Suggestions that imply code should be written and submitted on
  your behalf. The owner and their agents will write the code.

## When the freeze ends

The freeze ends when a **Contributor License Agreement (CLA)** is
drafted, reviewed, and adopted. The CLA will require the contributor
to either:

- **Assign copyright** to the project holder, or
- **Grant a sufficiently broad license** to the project holder so
  that the holder can offer the contributed code under both the
  GPL-3.0 and the alternative commercial terms.

Until that mechanism exists, this freeze remains in force.

## How to ask questions about the freeze

Open an issue titled "Question: contribution freeze" or contact the
owner through the channels listed in the README. Questions about
**why** the freeze exists are welcome; requests to be exempted from
the freeze are not, until the CLA exists.

## License of this document

This `CONTRIBUTING.md` is part of the AuraDesk project documentation
and is offered under the same terms as the source code. It is
**not** itself a CLA; it is a statement of the current policy.
