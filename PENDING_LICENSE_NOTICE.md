# Pending License Notice

**Status:** OPEN — must be resolved before any public distribution.
**Date opened:** 2026-10-17
**Owner:** garton (acting through Aura)
**Related ADR:** [`docs/decisions/0012-license.md`](../decisions/0012-license.md)

## Why this file exists

The `LICENSE` file at the root of this repository contains the verbatim
text of the GNU General Public License version 3 (without the "or any
later version" clause — i.e., GPL-3.0-only). That text is **the
license under which the source code is offered**. It is complete and
correct as a license grant.

The license grant, however, presupposes a **copyright holder** for
the source code. The copyright holder is the entity (or person) that
holds copyright in the source files and therefore has the exclusive
right to grant the GPL license and, in the future, alternative
commercial licenses.

**That copyright holder has not yet been identified.** This file
records that gap so the gap is visible and not silently filled.

## What is pending

The following are required to close this notice and make the
distribution complete:

1. **Identification of the copyright holder.** This may be:
   - A natural person (the owner themselves, named with the year and
     legal name they choose to publish under).
   - A legal entity they authorize (a company, association, or other
     organization). This requires the entity's full legal name,
     jurisdiction, and a contact address.
   - A future "AuraDesk Project" foundation or similar vehicle, **if
     and when** one is created.

2. **The copyright year.** The convention is to use the year of first
   publication of the work. The first commit of AuraDesk was
   `aae26e3` on 2026-10-16. If the holder chooses to backdate to
   2026, that year should be used.

3. **A signed or self-attested statement** that the identified
   holder is the author of (or has the right to license) the
   original AuraDesk code in this repository at the time the
   `LICENSE` file is updated.

## What is NOT pending

- The choice of **license** is decided: GPL-3.0-only. See ADR-0012.
- The dual-license **track** is decided in principle. See ADR-0012
  §2 and §3 for the structural conditions and limits.
- The dependency audit is **documentary** and recorded in
  `docs/licensing/dependency-license-audit.md`. It will be re-run
  once `Cargo.lock` and `pnpm-lock.yaml` exist.

## How this gap will be closed

When the holder is identified, the following will be done, **in this
order, in a single commit**:

1. Add a `Copyright (C) <YEAR> <HOLDER>` line to the top of every
   source file (or to a small set of root-level files that are
   deemed to represent the work as a whole, if file-level headers
   are impractical).
2. Update `README.md` to:
   - State the copyright holder explicitly.
   - Replace the "Pending" notice with the actual attribution.
3. Update this `PENDING_LICENSE_NOTICE.md` with a "Resolved" note
   pointing to the closing commit, and move it to
   `docs/licensing/license-history.md` for archival.
4. Update `CONTRIBUTING.md` if the holder has additional
   preferences for how attribution should be presented in the
   Contributor License Agreement (once that is drafted).
5. Update `docs/decisions/0012-license.md` to change the status
   from "Draft" to "Accepted".

## What does NOT happen until the gap is closed

- No public release, distribution, or publication of binaries.
- No claim of any specific commercial track.
- No acceptance of external code contributions (this is also
  blocked by the absence of a CLA — see `CONTRIBUTING.md`).

## Questions for the owner

To close this notice, please confirm the following in your reply:

1. **Who holds copyright in the AuraDesk source code at this
   commit (69bc85a)?** A name and a year.
2. **Is the holder a natural person, a legal entity, or to be
   declared as "AuraDesk Project" pending a future entity?**
3. **May I add a `Copyright (C) <YEAR> <HOLDER>` line to the
   `LICENSE` file as the only modification** (i.e., no other
   changes to the GPL-3.0 text), or do you prefer the copyright
   notice to live in source-file headers and a `NOTICE` file?
4. **Until the CLA is drafted, do you confirm the contribution
   freeze in `CONTRIBUTING.md` is correct and sufficient?**

These four questions, once answered, are the only thing standing
between this notice and the public distribution of the project.
