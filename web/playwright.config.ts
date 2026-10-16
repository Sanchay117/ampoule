// SPDX-License-Identifier: Apache-2.0
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  reporter: CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5199/',
    // Locally, use the installed Chrome instead of downloading Playwright's Chromium.
    channel: CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: CI ? 'npm run build && npm run preview' : 'npm run dev',
    url: 'http://localhost:5199/',
    reuseExistingServer: !CI,
    timeout: 240_000,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], channel: CI ? undefined : 'chrome' } },
  ],
});
