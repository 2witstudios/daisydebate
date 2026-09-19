import { defineConfig } from '@playwright/test';

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;
// Local Compose exposes PostgreSQL on 15432; CI service containers use 5432.
const postgresPort = process.env.E2E_POSTGRES_PORT ?? '15432';

export default defineConfig({
  testDir: './e2e',
  // `*.e2e.ts` keeps these files out of Bun's `*.spec.ts` test discovery.
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun run start',
    url: `${baseURL}/api/health/live`,
    name: 'production web',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
    env: {
      PORT: String(port),
      // The production configuration refinements must hold: HTTPS public URL,
      // deployment identity, no development credentials, proof route closed.
      PUBLIC_APP_URL: 'https://e2e.daisy.invalid',
      APP_VERSION: 'e2e',
      GIT_COMMIT: 'local-e2e',
      DATABASE_URL: `postgres://daisy_e2e:e2e-loopback-only@localhost:${postgresPort}/daisy_test`,
      REDIS_URL: 'redis://localhost:6379/2',
      REDIS_NAMESPACE: 'e2e',
      FOUNDATION_PROOF_ENABLED: 'false',
      LOG_LEVEL: 'warn',
    },
  },
});
