import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import canonical from './room-launch-config';
import { requireLaunchSlot } from './room-launch-slot';
import { realtimeBrowserProcesses } from './realtime-config-support';

requireLaunchSlot(resolve(import.meta.dirname, '../../../..'), process.env);
const web = resolve(import.meta.dirname, '../..');
const { chromium, webServer } = realtimeBrowserProcesses(
  canonical,
  process.env,
  web,
);
export default defineConfig({
  ...canonical,
  testDir: resolve(import.meta.dirname, '..'),
  testMatch: '**/realtime-room-delivery.e2e.ts',
  testIgnore: [],
  use: { ...canonical.use, trace: 'on' },
  outputDir: resolve(web, 'test-results/realtime'),
  projects: [{ ...chromium, testIgnore: [] }],
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: resolve(web, 'test-results/realtime-results.json') },
    ],
  ],
  webServer,
});
