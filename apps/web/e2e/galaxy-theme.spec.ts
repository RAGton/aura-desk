import { expect, test } from "@playwright/test";

/**
 * The galaxy (Aura Cockpit pyramid station) owns its visual identity: it must
 * stay deep-black in BOTH the light and the dark UI theme, while the rest of
 * the app may follow the global theme.
 */

const station = '[data-testid="aura-pyramid-station"]';

function isDarkColor(rgb: string): boolean {
  const match = rgb.match(/rgba?\(([^)]+)\)/);
  if (!match) return false;
  const parts = match[1].split(",").map((p) => Number(p.trim()));
  const [r, g, b] = parts;
  if ([r, g, b].some((v) => Number.isNaN(v))) return false;
  // Relative luminance threshold: anything clearly darker than mid grey counts.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.25;
}

/** Reads the galaxy canvas pixels as a plain RGBA array. */
async function readGalaxyPixels(page: import("@playwright/test").Page): Promise<number[] | null> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return null;
    const canvas = el.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    return Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  }, station);
}

/**
 * A fingerprint of the galaxy frame.
 *
 * The station loads its topology asynchronously — the Hindsight banks and
 * the RAGLight folders arrive after the first paint — so the canvas keeps
 * changing for a while after the page loads. Comparing a frame taken
 * straight away with one taken later compares two different galaxies.
 *
 * The `painted` count matters: an empty canvas is also "stable", so a
 * fingerprint alone would let the test capture the void before the stars
 * arrive.
 */
async function galaxySignature(
  page: import("@playwright/test").Page
): Promise<{ hash: string; painted: number } | null> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return null;
    const canvas = el.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    // FNV-1a over the whole frame.
    let hash = 2166136261 >>> 0;
    let painted = 0;
    for (let i = 0; i < data.length; i += 1) {
      hash ^= data[i];
      hash = Math.imul(hash, 16777619) >>> 0;
      if (data[i] + data[i + 1] + data[i + 2] > 36) painted += 1;
    }
    return { hash: `${canvas.width}x${canvas.height}:${hash.toString(16)}`, painted };
  }, station);
}

/** Waits until the galaxy has drawn its scene and stopped redrawing itself. */
async function waitForStableGalaxy(page: import("@playwright/test").Page): Promise<void> {
  let previous = await galaxySignature(page);
  let stableFor = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await page.waitForTimeout(400);
    const current = await galaxySignature(page);
    if (!current || !previous) {
      previous = current;
      stableFor = 0;
      continue;
    }
    // The scene arrives in stages — the pyramid first, the topology a
    // moment later — and there is a pause between the stages that is longer
    // than a single poll. So the frame has to hold steady for a while
    // before it counts as settled.
    if (current.painted > 500 && current.hash === previous.hash) {
      stableFor += 1;
      if (stableFor >= 3) return;
    } else {
      stableFor = 0;
    }
    previous = current;
  }
}

test.describe("galaxy theme identity", () => {
  // Reduced motion freezes the animation loop, so the galaxy renders the exact
  // same frame for every capture. That makes a pixel-perfect comparison
  // between the two themes possible.
  test.use({ reducedMotion: "reduce" });

  test("galaxy surface stays dark under the light theme", async ({ page }) => {
    await page.goto("/");

    const stationEl = page.locator(station);
    await expect(stationEl).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Capture the galaxy frame in the dark theme — this is the reference for
    // the galaxy's own visual identity. Wait for the scene to settle first:
    // the topology arrives after the first paint.
    await waitForStableGalaxy(page);
    const darkPixels = await readGalaxyPixels(page);
    expect(darkPixels).not.toBeNull();

    // Switch the app to the light theme through the real UI control.
    await page.getByRole("button", { name: /Alternar Tema|Switch Theme/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // The dedicated galaxy CSS variable must stay dark in the light theme.
    const galaxyBase = await page.evaluate(() => {
      const root = document.documentElement;
      const value = getComputedStyle(root).getPropertyValue("--aura-galaxy-base").trim();
      const probe = document.createElement("div");
      probe.style.color = value;
      root.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    });
    expect(
      isDarkColor(galaxyBase),
      `--aura-galaxy-base should be dark, got ${galaxyBase}`
    ).toBe(true);

    // The galaxy container paints its own opaque background: never the light
    // page background showing through the transparent canvas.
    const surfaceBg = await stationEl.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(
      isDarkColor(surfaceBg),
      `galaxy background-color should be dark, got ${surfaceBg}`
    ).toBe(true);

    // The space backdrop must not wash out to the light page background while
    // the cockpit galaxy is active.
    const backdropOpacity = await page
      .locator('[data-testid="aura-space-backdrop"] canvas')
      .evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(backdropOpacity)).toBeGreaterThan(0.5);

    // THE CORE ASSERTION: the galaxy renders the very same frame in the light
    // theme as in the dark theme. Its visual identity does not follow the
    // global UI theme. Before the fix, the light theme swapped every star,
    // orbit and globe for its washed-out palette and the canvas was mostly
    // empty, so this comparison failed hard.
    await waitForStableGalaxy(page);
    const lightPixels = await readGalaxyPixels(page);
    expect(lightPixels).not.toBeNull();

    const dark = darkPixels as number[];
    const light = lightPixels as number[];
    expect(light.length).toBe(dark.length);

    let differing = 0;
    let maxChannelDelta = 0;
    for (let i = 0; i < dark.length; i += 4) {
      const dr = Math.abs(dark[i] - light[i]);
      const dg = Math.abs(dark[i + 1] - light[i + 1]);
      const db = Math.abs(dark[i + 2] - light[i + 2]);
      const da = Math.abs(dark[i + 3] - light[i + 3]);
      const delta = Math.max(dr, dg, db, da);
      if (delta > 8) differing += 1;
      if (delta > maxChannelDelta) maxChannelDelta = delta;
    }
    const totalPixels = dark.length / 4;
    expect(
      differing,
      `the galaxy must render identically in both themes (${differing}/${totalPixels} pixels differ, max delta ${maxChannelDelta})`
    ).toBe(0);
  });

  test("galaxy surface stays dark under the dark theme", async ({ page }) => {
    await page.goto("/");
    const stationEl = page.locator(station);
    await expect(stationEl).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const surfaceBg = await stationEl.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(
      isDarkColor(surfaceBg),
      `galaxy background-color should be dark, got ${surfaceBg}`
    ).toBe(true);
  });
});
