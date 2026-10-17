# ADR-0012: License — GPL-3.0-only + dual-license commercial track (UNCONFIRMED)

**Status:** Draft — pending copyright holder identification
**Date:** 2026-10-17
**Author:** Aura (architect agent) per owner direction
**Supersedes:** Q16 in spec §13 (which proposed MIT as default)

## Context

The owner has chosen a public-license strategy for AuraDesk that is
distinct from the permissive default proposed during the spec's
drafting (MIT):

- **Public license:** GNU General Public License version 3, **only**
  (not "or later").
- **Commercial track:** keep open the option of offering alternative
  commercial terms in the future ("dual licensing").
- **Copyright:** preserve the original author's rights; do not invent a
  holder (person or legal entity) where none has been declared.
- **External contributions:** none accepted until an authorship,
  contribution, and relicensing policy is formalized.
- **Dependencies:** must be license-compatible before distribution.

This ADR records the strategy and its limits **as understood by the
author**. It does **not** constitute legal advice. Several points
below are explicit warnings about what the chosen license does and
does **not** provide.

## Decision

### 1. Public license: GPL-3.0-only

AuraDesk is distributed under the **GNU General Public License,
version 3, without the "or any later version" clause** (the SPDX
identifier is `GPL-3.0-only`).

Why GPL-3.0-only (and not, for example, AGPL, LGPL, or a permissive
license):

- The owner wants the source to remain open while preserving an
  optional commercial track. GPL-3.0 supports this through the
  copyright holder's exclusive right to grant additional terms.
- AGPL-3.0 would extend the copyleft to network use; this is a desktop
  app with no SaaS component, so AGPL is not required and is more
  restrictive than necessary.
- LGPL-3.0 would be a weaker copyleft; the owner chose the stronger one.
- A permissive license (MIT, Apache-2.0) was the default proposal
  during spec drafting; the owner has overridden it. The previous
  Q16 (MIT) in spec §13 is superseded by this ADR.

### 2. Dual-license commercial track (limits below)

The owner reserves the right, in the future, to offer AuraDesk under
**alternative commercial terms** to specific licensees. This is the
classical "dual licensing" model. It is **structurally possible**
under GPL-3.0 only because the **copyright holder** has the exclusive
right to grant additional licenses; the GPL itself does not grant
exclusivity to anyone.

**Critical limits of the dual-license model that the ADR will not
override:**

- The GPL-3.0 **does not prevent any third party from also selling
  copies** of the GPL-licensed software, provided they comply with
  the GPL (notably: provide complete corresponding source code, or
  a written offer to provide it, alongside the binary). The owner
  cannot claim commercial exclusivity that the public license does
  not grant. Any commercial exclusivity in the dual-license track
  is **only available to the specific licensee** under the
  alternative commercial terms, and only for the **code portions
  whose copyright the owner controls**.
- The "anti-tivoization" clause of GPL-3.0 (§6) applies if and when
  AuraDesk is distributed as a "User Product" on hardware that
  prevents installation of modified versions. For most desktop
  distributions (Tauri installers, NSIS, `.deb`/`.rpm`, etc.) this
  clause is **not** triggered, because the user can reinstall the
  app on general-purpose hardware. The owner should revisit this if
  the app is ever pre-installed on locked devices.

### 3. Rights the copyright holder must control for relicensing

For the dual-license track to be viable, the **copyright holder** must
hold copyright in **every line of code** distributed under the
alternative commercial terms. Concretely:

- The **owner's own contributions** are owned by the owner.
- **Third-party dependencies** remain under their original licenses
  (MIT, Apache-2.0, public domain, etc., per ADR-0012 §6). They can
  be sub-licensed into a commercial product only to the extent their
  original license permits. The audited set in §6 is **fully
  compatible** with this — every dependency is MIT, Apache-2.0, or
  public domain, all of which permit sub-licensing into proprietary
  products.
- **External contributions** (when eventually accepted) introduce
  copyright owned by the contributor. Without an explicit CLA or
  copyright assignment to the owner, the contributor's code **cannot
  be relicensed under the commercial track**. This is the **principal
  operational risk** for the dual-license model. It is addressed by
  the temporary contribution freeze below.

### 4. Copyright vs. license grant

This ADR makes a careful distinction that the README and other public
documents should also make:

- **Copyright** is the underlying property right in the source code.
  Copyright is held by the author(s) of each contribution. The owner
  has not yet declared who holds copyright in the original
  AuraDesk code. **The `LICENSE` file at the root of this repository
  will use a placeholder for the copyright holder until the owner
  identifies themselves or an entity they authorize.**
- **License** is the grant of permission to use, copy, modify, and
  distribute under stated conditions. The license does not transfer
  copyright.

The README will be updated to make this distinction clear, and
**will not** claim the existence of any specific copyright holder,
company, CNPJ, address, or corporate entity.

### 5. Temporary contribution freeze

Until a Contributor License Agreement (CLA) or equivalent legal
mechanism is drafted and adopted:

- The project **does not accept external code contributions**.
- This applies to pull requests, issue patches, vendor contributions,
  and any other form of code submission.
- Issues, bug reports, and feature requests remain welcome; they do
  not constitute code contributions.
- The freeze is **temporary**. It will be lifted when the CLA is in
  place; the CLA must require the contributor to either (a) assign
  copyright to the owner, or (b) grant the owner a sufficiently broad
  license to enable dual-licensing.
- A `CONTRIBUTING.md` is published today that makes this freeze
  explicit and links to this ADR.

### 6. Dependency compatibility (summary)

A documentary audit of all dependencies declared in the spec was
performed on 2026-10-17. Full results are in
`docs/licensing/dependency-license-audit.md`. Headline findings:

- **All declared dependencies are compatible with GPL-3.0-only.**
  Every direct dependency is MIT, MIT-OR-Apache-2.0, Apache-2.0, or
  public domain. GPL-3.0 explicitly allows combining with code under
  all of these.
- **No copyleft conflicts.** No dependency is GPL, LGPL, AGPL, or
  any other copyleft license that would create an obligation to
  relicense AuraDesk itself.
- **shadcn/ui (MIT) is copy-pasted** into the project. The MIT
  license permits this; the user must preserve the MIT copyright
  notice in each copied component file. This is a process
  requirement, not a legal conflict.
- **No code is included yet.** The audit is documentary, based on
  the spec's declared stack (spec §5) and the latest published
  package metadata. A second automated audit must run once a
  `Cargo.lock` and `pnpm-lock.yaml` are produced.
- **No bundling of assets is committed yet.** Sounds, icons, and
  fonts will need a separate audit at the time they are added.

### 7. Trademarks, logo, and other non-copyright assets

This ADR is about the **copyright license** of the source code. It
does not grant any rights to the "AuraDesk" name, logo, iconography,
or other brand assets. GPL-3.0 **does not** cover trademarks; the
trademark is a separate right that the owner (when defined) must
register and defend independently.

A future document (a trademark policy, not part of this ADR) will
define how third parties may or may not use the AuraDesk name and
logo. Until that document exists, all trademark rights are reserved.

### 8. Alternatives considered

| Alternative | Why not chosen (for now) |
|---|---|
| MIT | Default in spec Q16; explicitly rejected by the owner in favor of copyleft. |
| Apache-2.0 | Also permissive; same reason. |
| AGPL-3.0-only | Triggers copyleft on network use. AuraDesk is a desktop app with no server component; AGPL is more restrictive than necessary. |
| LGPL-3.0-only | Weaker copyleft; allows proprietary linking. Owner chose the stronger copyleft. |
| MPL-2.0 | File-level copyleft; the owner preferred project-level copyleft. |
| Dual: GPL-3.0 **or** MIT | Considered; would defeat the purpose, since MIT is more permissive. |
| BSL / Business Source License | Not OSI-approved; not appropriate for a personal-productivity app intended to be open source. |

### 9. Risks and conditions to reassess

| Risk | Mitigation / condition to reassess |
|---|---|
| External contribution without CLA poisons the relicensing path | **Freeze is in force** (see §5). Re-evaluate when CLA is drafted. |
| Copyleft restricts downstream integrations | Accepted: the owner chose this. Document clearly in README. |
| Trademark conflict (someone else uses "AuraDesk" name) | Out of scope for this ADR; raised in §7. Reassess when trademark policy exists. |
| A future dep is copyleft (e.g., switches to GPL or AGPL) | The next dependency audit (post-`Cargo.lock`) will catch it. The build will not pass if a forbidden dep is added. |
| Anti-tivoization clause trips on locked hardware | Currently N/A. Reassess if AuraDesk is ever pre-installed on locked devices. |
| The owner has not declared a copyright holder | **Pending decision.** The `LICENSE` file ships with a placeholder; this ADR is **not** complete until the holder is identified. |

### 10. Reassessment triggers

This decision should be revisited when **any** of the following
occurs:

- A copyright holder is formally identified.
- A CLA is drafted and ready for adoption.
- A new dependency with a non-permissive license is added.
- AuraDesk is bundled on locked hardware.
- A third party makes a substantive relicensing request.
- The commercial track is actually launched and a contract template
  is needed.

## Consequences

Positive:
- The public license preserves the source code as open in a strong
  copyleft sense.
- The dual-license track is **structurally possible** because the
  owner holds (or will hold) copyright in the original code, and all
  dependencies are permissive.
- The anti-tivoization clause of GPL-3.0 is mostly a non-issue for a
  desktop app.

Negative:
- The dual-license track **does not provide commercial exclusivity**
  in the market; any third party can also distribute the GPL version
  subject to GPL terms.
- The contribution freeze slows community growth until a CLA exists.
- The trademark is not covered by this decision; the name "AuraDesk"
  remains unprotected until a separate policy exists.
- The "holder pending" status of this ADR and the placeholder
  copyright in the `LICENSE` file are open items that must be
  resolved before any public distribution.

## Status of this ADR

**DRAFT — NOT YET EFFECTIVE.** The decision to use GPL-3.0-only is
recorded here, but the ADR is not final until:

1. The copyright holder is identified and the `LICENSE` file's
   placeholder is filled in.
2. The owner confirms the wording of the README, the `CONTRIBUTING.md`,
   and this ADR.
3. The dependency audit document is reviewed and signed off.

Until then, no public distribution should occur.
