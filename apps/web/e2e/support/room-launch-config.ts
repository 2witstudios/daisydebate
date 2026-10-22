import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import canonical from '../../playwright.config';
import { requireLaunchSlot } from './room-launch-slot';
import { launchWorkerPolicy } from './room-launch-worker-policy';

const slot = requireLaunchSlot(
  resolve(import.meta.dirname, '../../../..'),
  process.env,
);
const web = resolve(import.meta.dirname, '../..');
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
  testMatch: [
    '**/room-launch.e2e.ts',
    '**/ballot.e2e.ts',
    '**/debate-room.e2e.ts',
    '**/round-commands.e2e.ts',
    '**/round-command-recovery.e2e.ts',
    '**/attendance.e2e.ts',
  ],
  testIgnore: [],
  use: {
    ...canonical.use,
    ignoreHTTPSErrors: false,
    trace: 'off',
    video: 'off',
  },
  timeout: 120_000,
  outputDir: resolve(web, 'test-results'),
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: resolve(web, 'test-results/room-launch-results.json') },
    ],
  ],
  projects: projects.map((project) => ({
    ...project,
    testIgnore: [],
    use: {
      ...project.use,
      channel: 'chromium',
      ignoreHTTPSErrors: false,
      launchOptions: {
        chromiumSandbox: true,
        args: ['--use-fake-device-for-media-stream'],
      },
      connectOptions: { wsEndpoint: process.env.PW_WS_ENDPOINT! },
    },
  })),
  webServer: servers.slice(0, 1).map((server) => {
    if (!server) throw new Error('Canonical browser server is missing');
    return {
      ...server,
      cwd: resolve(web, server.cwd ?? '.'),
      reuseExistingServer: false,
      ignoreHTTPSErrors: false,
      timeout: 120000,
      command: server.command.replace(
        'e2e/support/server.ts',
        'e2e/support/room-launch-server.ts',
      ),
      env: {
        ...server.env,
        E2E_DATABASE_URL: process.env.E2E_DATABASE_URL!,
        E2E_REDIS_URL: process.env.E2E_REDIS_URL!,
        E2E_REDIS_NAMESPACE: process.env.E2E_REDIS_NAMESPACE!,
        E2E_PORT: process.env.E2E_PORT!,
        AI_ROUND_BUSY_CAP: '4',
        ROUND_BOT_WORKER_POLICY: launchWorkerPolicy,
        NODE_EXTRA_CA_CERTS: process.env.NODE_EXTRA_CA_CERTS!,
        E2E_LOCAL_TLS_CERT: process.env.E2E_LOCAL_TLS_CERT!,
        E2E_LOCAL_TLS_KEY: process.env.E2E_LOCAL_TLS_KEY!,
        LIVEKIT_URL: 'http://127.0.0.1:7880',
        LIVEKIT_PUBLIC_URL: `wss://localhost:${slot.port + 4}`,
        LIVEKIT_API_KEY: 'daisy-local',
        LIVEKIT_API_SECRET: 'local-development-only-livekit-secret',
      },
    };
  }),
});
