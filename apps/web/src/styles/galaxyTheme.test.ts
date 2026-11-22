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

  it("declares a galaxy chrome palette that stays light-on-dark", () => {
    const dark = ruleBody(globalsCss, DARK_THEME_RULE);
    const light = ruleBody(globalsCss, LIGHT_THEME_RULE);

    for (const name of [
      "--aura-galaxy-surface",
      "--aura-galaxy-border",
      "--aura-galaxy-text",
      "--aura-galaxy-text-muted",
    ]) {
      expect(cssVar(dark, name)).toBe(cssVar(light, name));
    }
  });

  it("re-maps the raw Tailwind tokens inside the galaxy subtree", () => {
    const surface = ruleBody(globalsCss, ".aura-galaxy-surface");
    // The floating chrome (pills, drawers, inputs) uses the Tailwind
    // `aura-*` utilities, which resolve to the raw --text-* / --bg-* tokens.
    // Those have to be re-scoped here, or the chrome keeps the light
    // theme's dark-on-white values and becomes unreadable on the black
    // cosmos.
    for (const name of [
      "--text-primary",
      "--text-secondary",
      "--text-muted",
      "--bg-surface",
      "--bg-elevated",
      "--border-subtle",
    ]) {
      expect(surface).toContain(`${name}:`);
    }
  });

  it("keeps the galaxy chrome text bright enough to read on black", () => {
    const value = cssVar(ruleBody(globalsCss, DARK_THEME_RULE), "--aura-galaxy-text");
    const rgb = value.match(/\d+/g)!.map(Number);
    const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    expect(luminance).toBeGreaterThan(0.5);
  });

  it("exempts the galaxy chrome scope from the light-theme slate remap", () => {
    // The project remaps the slate utilities to the light theme's tokens so
    // dark-on-white text stays readable. The galaxy chrome is dark-on-light
    // in BOTH themes, so that remap must not reach it — otherwise the
    // prompt dock's input turns near-black on the black cosmos.
    const scopeRules = globalsCss.match(
      /html\[data-theme="light"\]\s+\.aura-galaxy-chrome-scope[^{]*\{[^}]*\}/g,
    );
    expect(scopeRules).not.toBeNull();
    expect(scopeRules!.length).toBeGreaterThan(0);
    // The exemption must re-assert a light colour, not the theme token.
    expect(scopeRules!.join("\n")).not.toContain("rgb(var(--text-primary))");
  });

  it("gives the quick-action chips a dedicated galaxy class", () => {
    const chip = ruleBody(globalsCss, ".aura-galaxy-chip");
    const rgb = chip.match(/background-color:\s*rgba?\(([^)]+)\)/)![1];
    const parts = rgb.split(",").map((p) => Number(p.trim()));
    const luminance =
      (0.299 * parts[0] + 0.587 * parts[1] + 0.114 * parts[2]) / 255;
    expect(luminance).toBeLessThan(0.25);
  });

  it("remaps status and elevated surface tokens inside both galaxy scopes", () => {
    const surface = ruleBody(globalsCss, ".aura-galaxy-surface");
    const scope = ruleBody(globalsCss, ".aura-galaxy-chrome-scope");
    for (const token of ["--bg-elevated", "--status-info", "--status-success", "--accent-primary"]) {
      expect(surface).toContain(`${token}:`);
      expect(scope).toContain(`${token}:`);
    }
    expect(globalsCss).toContain('.aura-galaxy-chrome-scope .bg-slate-950\\/75');
    expect(globalsCss).toContain('.aura-galaxy-surface .text-sky-300');
  });

  it("applies Liquid Glass Cosmic tokens and keeps the background transparent over the 3D universe in the light theme", () => {
    const light = ruleBody(globalsCss, LIGHT_THEME_RULE);
    const lightBgBase = cssVar(light, "--aura-bg-base");
    expect(lightBgBase).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    expect(hexLuminance(lightBgBase)).toBeLessThan(0.25);

    expect(light).toContain("--aura-liquid-gradient:");
    expect(light).toContain("--aura-liquid-gradient-elevated:");
    expect(light).toContain("--aura-liquid-rim:");

    const lightAuraBg = ruleBody(globalsCss, 'html[data-theme="light"] .aura-bg');
    expect(lightAuraBg).toContain("background-color: transparent");

    const lightAuraGlass = ruleBody(globalsCss, 'html[data-theme="light"] .aura-glass');
    expect(lightAuraGlass).toContain("var(--aura-liquid-gradient)");
    expect(lightAuraGlass).toContain("var(--aura-liquid-rim)");
  });
});
