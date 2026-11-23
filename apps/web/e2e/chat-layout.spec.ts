import { expect, test } from "@playwright/test";

/**
 * The conversation panel must be dockable on the left, on the right or
 * centered over the galaxy, and it must be able to go translucent while
 * keeping the text readable.
 */

const panel = '[data-testid="aura-chat-panel"]';
const station = '[data-testid="aura-pyramid-station"]';
const transcript = '[data-testid="aura-transcript"]';

test.describe("conversation panel layout", () => {
  test.use({ reducedMotion: "reduce" });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // The chat lives in the "Aura IA" tab.
    await page.getByRole("button", { name: /Aura IA/i }).first().click();
    await expect(page.locator(station)).toBeVisible();
  });

  test("can be docked right, left and centered", async ({ page }) => {
    const layoutButton = page.getByTestId("aura-layout-menu-btn");

    // Default: docked on the right.
    await layoutButton.click();
    await page.getByTestId("aura-dock-right").click();
    await expect(page.locator(panel)).toHaveClass(/lg:order-2/);

    // Docked on the left.
    await layoutButton.click();
    await page.getByTestId("aura-dock-left").click();
    await expect(page.locator(panel)).toHaveClass(/lg:order-1/);

    // Centered: the panel floats over the station.
    await layoutButton.click();
    await page.getByTestId("aura-dock-center").click();
    await expect(page.locator(panel)).toHaveClass(/absolute/);
    await expect(page.locator(station)).toBeVisible();

    // The station keeps the full width behind the centered panel.
    const stationBox = await page.locator(station).boundingBox();
    const panelBox = await page.locator(panel).boundingBox();
    expect(stationBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.width).toBeLessThan(stationBox!.width);
  });

  test("transparency keeps the text layer more opaque than the chrome", async ({
    page,
  }) => {
    const layoutButton = page.getByTestId("aura-layout-menu-btn");
    await layoutButton.click();
    await page.getByTestId("aura-transparency-clear").click();

    await expect(page.locator(transcript)).toBeVisible();

    const opacityOf = async (selector: string) => {
      return page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const match = getComputedStyle(el).backgroundColor.match(
          /rgba?\(([^)]+)\)/
        );
        if (!match) return null;
        const parts = match[1].split(",").map((p) => Number(p.trim()));
        return parts.length > 3 ? parts[3] : 1;
      }, selector);
    };

    const containerOpacity = await opacityOf(panel);
    const transcriptOpacity = await opacityOf(transcript);

    expect(containerOpacity).not.toBeNull();
    expect(transcriptOpacity).not.toBeNull();
    // The text area must sit on a darker layer than the surrounding chrome.
    expect(transcriptOpacity!).toBeGreaterThan(containerOpacity!);
  });

  test("the status chrome is collapsed into a single floating menu", async ({
    page,
  }) => {
    // The runtime badges are not on screen until the menu is opened.
    await expect(page.getByText(/Hermes CLI offline/i)).not.toBeVisible();

    await page.getByTestId("aura-status-menu-btn").click();

    await expect(page.getByText(/Hermes CLI offline/i)).toBeVisible();
  });
});
