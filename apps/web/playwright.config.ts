import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // Lets a sandbox with a preinstalled Chromium run tests without downloading browsers.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // Run against a production build: `pnpm build` first.
    command: `pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    // Many sign-ups from one IP in a few seconds would trip the (real) rate limit.
    // No separate worker process: background jobs run inside the web server (ADR-011 inline mode).
    env: { AUTH_RATE_LIMIT: 'off', APP_URL: `http://localhost:${PORT}`, JOB_RUNNER: 'inline' },
    timeout: 60_000,
  },
});
