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
    // AI is replay-only with no key: the tests (and the demo rehearsal) never reach the AI provider.
    env: {
      AUTH_RATE_LIMIT: 'off',
      APP_URL: `http://localhost:${PORT}`,
      JOB_RUNNER: 'inline',
      AI_REPLAY_MODE: 'replay',
      ANTHROPIC_API_KEY: '',
      // Webhooks (M16): sealed secrets, and a test receiver on localhost.
      CONNECTOR_SECRET: process.env.CONNECTOR_SECRET || 'e2e-connector-secret-0123456789abcdef',
      WEBHOOKS_ALLOW_PRIVATE: 'on',
    },
    timeout: 60_000,
  },
});
