import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The galaxy (Aura Cockpit) has its own visual identity: it must stay
 * deep-black in BOTH the light and the dark UI theme. These assertions guard
 * the CSS contract that keeps the cosmos from inheriting the global theme.
 */

const globalsCss = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "globals.css"),
  "utf8"
);

/** Extracts the body of a CSS rule that starts with the given selector. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  if (!match) throw new Error(`CSS rule not found: ${selector}`);
  return match[1];
}

function cssVar(css: string, name: string): string {
  const match = new RegExp(`${name}\\s*:\\s*([^;]+);`, "m").exec(css);
  if (!match) throw new Error(`CSS variable not found: ${name}`);
  return match[1].trim();
}

/** Relative luminance of a hex colour, used to tell "dark" from "light". */
function hexLuminance(hex: string): number {
  const normalized = hex.replace("#", "").trim();
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

const DARK_THEME_RULE = ':root,\nhtml[data-theme="dark"]';
const LIGHT_THEME_RULE = 'html[data-theme="light"]';

describe("galaxy theme identity (CSS)", () => {
  it("declares a dedicated galaxy base colour", () => {
    expect(globalsCss).toContain("--aura-galaxy-base");
  });

  it("keeps the galaxy base dark in the dark theme", () => {
    const value = cssVar(ruleBody(globalsCss, DARK_THEME_RULE), "--aura-galaxy-base");
    expect(value).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    expect(hexLuminance(value)).toBeLessThan(0.25);
  });

  it("keeps the galaxy base dark in the light theme", () => {
    const value = cssVar(ruleBody(globalsCss, LIGHT_THEME_RULE), "--aura-galaxy-base");
    expect(value).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    expect(hexLuminance(value)).toBeLessThan(0.25);
  });

  it("uses the same galaxy palette in both themes", () => {
    const dark = ruleBody(globalsCss, DARK_THEME_RULE);
    const light = ruleBody(globalsCss, LIGHT_THEME_RULE);
    expect(cssVar(light, "--aura-galaxy-base")).toBe(cssVar(dark, "--aura-galaxy-base"));
    expect(cssVar(light, "--aura-galaxy-deep")).toBe(cssVar(dark, "--aura-galaxy-deep"));
  });

  it("gives the galaxy container its own opaque background", () => {
    const surface = ruleBody(globalsCss, ".aura-galaxy-surface");
    expect(surface).toContain("var(--aura-galaxy-base)");
  });

  it("forces the deep-space nebula palette in the light theme", () => {
    const dark = ruleBody(globalsCss, ".aura-galaxy-nebula");
    const forced = ruleBody(
      globalsCss,
      '.aura-galaxy-nebula-dark,\nhtml[data-theme="light"] .aura-galaxy-nebula-dark'
    );
    // The forced variant must paint the same deep-space gradient as the
    // default dark nebula — not the washed-out light palette.
    const darkGradient = dark.match(/background-image:([^;]+);/)![1].trim();
    expect(forced).toContain(darkGradient);
  });
});
