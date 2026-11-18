import fs from "node:fs";
import { chromium, defineConfig, devices } from "@playwright/test";

function resolveLocalChromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  }
  if (process.env.CI) {
    return undefined;
  }
  try {
    if (fs.existsSync(chromium.executablePath())) {
      return undefined;
    }
  } catch {
    // ignore missing default playwright browser lookup
  }
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ];
  return candidates.find((p) => fs.existsSync(p));
}

const resolvedExecutablePath = resolveLocalChromiumExecutable();

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
    screenshot: "on",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(resolvedExecutablePath
          ? {
              launchOptions: {
                executablePath: resolvedExecutablePath,
              },
            }
          : {}),
      },
    },
  ],
  webServer: {
    command: "pnpm preview --port 4173 --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
