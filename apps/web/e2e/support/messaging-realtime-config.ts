import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import canonical, {
  resolveE2EOrigin,
  resolveE2EPorts,
  resolveE2EServices,
} from '../../playwright.config';
import { messagingBrowserTarget } from './messaging-data';
messagingBrowserTarget(
  process.env,
  resolve(import.meta.dirname, '../../../..'),
);
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
  throw new Error('Canonical messaging browser processes unavailable');
export default defineConfig({
  ...canonical,
  testDir: resolve(import.meta.dirname, '..'),
  testMatch: '**/messaging-realtime.e2e.ts',
  projects: [{ ...chromium, testIgnore: [] }],
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/messaging-realtime-results.json' }],
  ],
  webServer: servers.map((server, index) => {
    if (!server)
      throw new Error('Canonical messaging browser server unavailable');
    return {
      ...server,
      command:
        index === 0
          ? server.command
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
        REALTIME_PUBLIC_URL: endpoint,
        REALTIME_ALLOWED_ORIGINS: resolveE2EOrigin(process.env),
      },
    };
  }),
});
