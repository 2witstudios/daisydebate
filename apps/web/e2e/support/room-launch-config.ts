import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import canonical from '../../playwright.config';
import { requireLaunchSlot } from './room-launch-slot';

requireLaunchSlot(resolve(import.meta.dirname, '../../../..'), process.env);
const servers = Array.isArray(canonical.webServer)
  ? canonical.webServer
  : [canonical.webServer];
const projects = canonical.projects?.filter(
  (project) => project.name === 'chromium',
);
if (!projects?.length) throw new Error('Canonical Chromium project is missing');
export default defineConfig({
  ...canonical,
  testDir: resolve(import.meta.dirname, '..'),
  testMatch: '**/room-launch.e2e.ts',
  timeout: 120_000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/room-launch-results.json' }],
  ],
  projects,
  webServer: servers.map((server, index) => {
    if (!server) throw new Error('Canonical browser server is missing');
    return index === 0
      ? {
          ...server,
          command: server.command.replace(
            'e2e/support/server.ts',
            'e2e/support/room-launch-server.ts',
          ),
          reuseExistingServer: false,
          env: {
            ...server.env,
            E2E_DATABASE_URL: process.env.E2E_DATABASE_URL!,
            E2E_REDIS_URL: process.env.E2E_REDIS_URL!,
            E2E_REDIS_NAMESPACE: process.env.E2E_REDIS_NAMESPACE!,
            E2E_PORT: process.env.E2E_PORT!,
          },
        }
      : { ...server, reuseExistingServer: false };
  }),
});
