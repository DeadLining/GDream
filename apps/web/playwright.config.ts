import {defineConfig, devices} from '@playwright/test';

const port = process.env.E2E_PORT ?? '3000';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'line',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {name: 'desktop', use: {...devices['Desktop Chrome'], channel: 'chrome', viewport: {width: 1440, height: 900}}},
    {name: 'mobile', use: {...devices['iPhone 13'], browserName: 'chromium', channel: 'chrome'}},
  ],
});
