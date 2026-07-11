import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {name: 'desktop', use: {...devices['Desktop Chrome'], channel: 'chrome', viewport: {width: 1440, height: 900}}},
    {name: 'mobile', use: {...devices['iPhone 13'], browserName: 'chromium', channel: 'chrome'}},
  ],
});
