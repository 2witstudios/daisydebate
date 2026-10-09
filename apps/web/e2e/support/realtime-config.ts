import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import canonical, {
  resolveE2EOrigin,
  resolveE2EPorts,
  resolveE2EServices,
} from '../../playwright.config';
import { requireLaunchSlot } from './room-launch-slot';

requireLaunchSlot(resolve(import.meta.dirname, '../../../..'), process.env);
const ports = resolveE2EPorts(process.env);
const endpoint = `wss://localhost:${ports.realtime}/ws`;
const services = resolveE2EServices(process.env);
const servers = Array.isArray(canonical.webServer)
  ? canonical.webServer
  : [canonical.webServer];
const chromium = canonical.projects?.find(
  (project) => project.name === 'chromium',
);
if (!chromium || servers.length !== 2 || !servers[0] || !servers[1])
  throw new Error('Canonical realtime browser processes are unavailable');
export default defineConfig({
  ...canonical,
  testDir: resolve(import.meta.dirname, '..'),
  testMatch: '**/realtime-room-delivery.e2e.ts',
  testIgnore: [],
  outputDir: 'test-results/realtime',
  projects: [{ ...chromium, testIgnore: [] }],
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/realtime-results.json' }],
  ],
  webServer: servers.map((server, index) => {
    if (!server) throw new Error('Canonical browser server unavailable');
    return {
      ...server,
      command:
        index === 0
          ? server.command.replace(
              'e2e/support/server.ts',
              'e2e/support/room-launch-server.ts',
            )
          : server.command.replace(
              'src/start.ts',
              'integration/browser-server.ts',
            ),
      ...(index === 1
        ? {
            url: `https://localhost:${ports.realtime}/health/ready`,
            ignoreHTTPSErrors: true,
          }
        : {}),
      reuseExistingServer: false,
      env: {
        ...server.env,
        ...services,
        E2E_DATABASE_URL: process.env.E2E_DATABASE_URL!,
        E2E_REDIS_URL: process.env.E2E_REDIS_URL!,
        E2E_REDIS_NAMESPACE: process.env.E2E_REDIS_NAMESPACE!,
        E2E_PORT: process.env.E2E_PORT!,
        REALTIME_PUBLIC_URL: endpoint,
        REALTIME_ALLOWED_ORIGINS: resolveE2EOrigin(process.env),
      },
    };
  }),
});
