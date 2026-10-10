import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import canonical from '../../playwright.config';
import { realtimeBrowserProcesses } from './realtime-config-support';
import { messagingBrowserTarget } from './messaging-data';
messagingBrowserTarget(
  process.env,
  resolve(import.meta.dirname, '../../../..'),
);
const web = resolve(import.meta.dirname, '../..');
const { chromium, webServer } = realtimeBrowserProcesses(
  canonical,
  process.env,
  web,
);
export default defineConfig({
  ...canonical,
  outputDir: resolve(web, 'test-results/messaging-realtime'),
  testDir: resolve(import.meta.dirname, '..'),
  testMatch: '**/messaging-realtime.e2e.ts',
  testIgnore: [],
  projects: [{ ...chromium, testIgnore: [] }],
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: resolve(
          web,
          'test-results/messaging-realtime-results.json',
        ),
      },
    ],
  ],
  webServer,
});
