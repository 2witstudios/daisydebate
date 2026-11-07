import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import canonical from '../../playwright.config';
import { realtimeBrowserProcesses } from './realtime-config-support';
import { messagingBrowserTarget } from './messaging-data';
import { launchLiveKit } from './launch-livekit';
import { requireLaunchSlot } from './room-launch-slot';
messagingBrowserTarget(
  process.env,
  resolve(import.meta.dirname, '../../../..'),
);
const web = resolve(import.meta.dirname, '../..');
const slot = requireLaunchSlot(resolve(web, '../..'), process.env);
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
  projects: [
    {
      ...chromium,
      use: { ...chromium.use, channel: 'chromium' },
      testIgnore: [],
    },
  ],
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
  webServer: [
    ...webServer.map((server, index) =>
      index === 0
        ? {
            ...server,
            env: {
              ...server.env,
              E2E_MESSAGING_RECOVERY: '1',
              LIVEKIT_URL: launchLiveKit.url,
              LIVEKIT_PUBLIC_URL: `wss://localhost:${slot.port + 7}`,
              LIVEKIT_API_KEY: launchLiveKit.apiKey,
              LIVEKIT_API_SECRET: launchLiveKit.apiSecret,
            },
          }
        : server,
    ),
    {
      command: 'bun e2e/support/messaging-media-edge.ts',
      cwd: web,
      url: `https://localhost:${slot.port + 7}`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
  ],
});
