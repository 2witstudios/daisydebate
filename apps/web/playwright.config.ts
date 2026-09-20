import { defineConfig } from '@playwright/test';

type Env = Readonly<Record<string, string | undefined>>;

// Ports derive from the environment so parallel local sessions can pin their
// own stack; see docs/development/local-development.md ("Parallel sessions").
export const resolveE2EPort = (env: Env): number =>
  Number(env.E2E_PORT ?? 3100);
export const resolveE2ERedisPort = (env: Env): string =>
  env.E2E_REDIS_PORT ?? '6379';
// Reusing an already-running server on an explicitly pinned port would run
// the suite against another session's code; only the un-pinned default may
// reuse. CI never reuses.
export const resolveReuseExistingServer = (env: Env): boolean =>
  env.CI ? false : env.E2E_PORT === undefined;

const port = resolveE2EPort(process.env);
const baseURL = `http://127.0.0.1:${port}`;
// Local Compose exposes PostgreSQL on 15432; CI service containers use 5432.
const postgresPort = process.env.E2E_POSTGRES_PORT ?? '15432';
const redisPort = resolveE2ERedisPort(process.env);

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
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    // Keep structured server output beside Playwright's failure artifacts.
    command:
      'mkdir -p test-results && bun run start > test-results/server.log 2>&1',
    url: `${baseURL}/api/health/live`,
    name: 'production web',
    timeout: 60_000,
    reuseExistingServer: resolveReuseExistingServer(process.env),
    gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
    env: {
      PORT: String(port),
      // The production configuration refinements must hold: HTTPS public URL,
      // deployment identity, no development credentials, proof route closed.
      PUBLIC_APP_URL: 'https://e2e.daisy.invalid',
      APP_VERSION: 'e2e',
      GIT_COMMIT: 'local-e2e',
      DATABASE_URL: `postgres://daisy_e2e:e2e-loopback-only@localhost:${postgresPort}/daisy_test`,
      REDIS_URL: `redis://localhost:${redisPort}/2`,
      REDIS_NAMESPACE: 'e2e',
      FOUNDATION_PROOF_ENABLED: 'false',
      LOG_LEVEL: 'info',
    },
  },
});
