# ADR-005: Tailwind v4 + shadcn/ui for the UI

**Status:** Accepted
**Date:** 2026-10-16

## Context

We need a UI stack that:

- Produces a small bundle (Tauri's WebView is a fixed-cost asset).
- Gives us a consistent design system without handcrafting every
  component.
- Allows accessibility primitives (Radix under the hood) for keyboard
  navigation and screen readers.
- Lets us audit every component in the repo (no opaque node_modules
  surprises).

Options considered:

- **Tailwind v4 + shadcn/ui**: atomic CSS, components copy-pasted into
  the repo, Radix primitives under the hood.
- **CSS Modules + Radix UI**: more "vanilla", but more CSS to write by
  hand for the same visual result.
- **CSS-in-JS (vanilla-extract, etc.)**: runtime cost in WebView; not
  justified for this app's complexity.

## Decision

Use **Tailwind CSS v4** as the styling layer and **shadcn/ui** as the
component library. `shadcn` components are not installed as a package;
they are copied into `apps/web/src/components/ui/` and customized in
place. Tailwind v4 uses the new `@theme` inline configuration; we pin
the major version and let it ride patches.

## Consequences

Positive:
- Zero component dep in `node_modules`; what we use is what we have.
- Radix primitives give us accessibility (ARIA, focus management) for
  free.
- Tailwind v4 build is fast; class names are local to components.
- Easy to theme (we'll override CSS variables in `globals.css`).

Negative:
- Copy-paste means we own the components. If shadcn publishes a security
  fix, we re-copy (acceptable for a small surface).
- Some boilerplate per component (e.g. wrapping Radix with our
  `cn()` helper).
