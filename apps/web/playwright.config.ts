import { defineConfig } from '@playwright/test';

type Env = Readonly<Record<string, string | undefined>>;

// Ports derive from the environment; `bun slot:up` writes each checkout's
// own (docs/development/local-development.md, "Parallel sessions").
export const resolveE2EPort = (env: Env): number =>
  Number(env.E2E_PORT ?? 3100);
// The slot's database and Redis namespace come only from explicit settings
// (written by `bun slot:up`, set by CI). A missing value is passed as empty,
// which the server's configuration rejects at startup, so a suite can never
// silently run against another checkout's data.
export const resolveE2EServices = (env: Env) => ({
  DATABASE_URL: env.E2E_DATABASE_URL ?? '',
  REDIS_URL: env.E2E_REDIS_URL ?? '',
  REDIS_NAMESPACE: env.E2E_REDIS_NAMESPACE ?? '',
});
// Reusing an already-running server on an explicitly pinned port would run
// the suite against another session's code; only the un-pinned default may
// reuse. CI never reuses.
export const resolveReuseExistingServer = (env: Env): boolean =>
  env.CI ? false : env.E2E_PORT === undefined;

// Screenshot parity is pixel-exact only in the Linux Playwright image that
// matches @playwright/test. `bun visual:server` runs that image's browser
// server; pointing PW_WS_ENDPOINT at it keeps the app on the host and the
// browser in Linux (docs/development/testing.md, "Visual parity").
export const resolveBrowserEndpoint = (env: Env): string | undefined =>
  env.PW_WS_ENDPOINT || undefined;
// Non-Linux hosts render fonts differently; without the Linux browser
// server they must not compare against Linux baselines.
export const runsVisualProject = (env: Env, platform: string): boolean =>
  platform === 'linux' || resolveBrowserEndpoint(env) !== undefined;

// One production server per run: the app on the pinned port, a loopback TLS
// edge on the next (production requires an HTTPS origin, and Secure session
// cookies need one in a real browser), and the mail capture after that.
export const resolveE2EPorts = (env: Env) => {
  const app = resolveE2EPort(env);
  return { app, edge: app + 1, mail: app + 2 };
};
/** The public origin the server is configured with and the browser uses. */
export const resolveE2EOrigin = (env: Env): string =>
  `https://localhost:${resolveE2EPorts(env).edge}`;

const ports = resolveE2EPorts(process.env);
const origin = resolveE2EOrigin(process.env);
const browserEndpoint = resolveBrowserEndpoint(process.env);

export default defineConfig({
  testDir: './e2e',
  // `*.e2e.ts` keeps these files out of Bun's `*.spec.ts` test discovery.
  testMatch: '**/*.e2e.ts',
  snapshotPathTemplate: '{testDir}/visual-baselines/{arg}{ext}',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: origin,
    // The edge presents a per-run self-signed certificate for localhost.
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'functional', testIgnore: '**/visual.e2e.ts' },
    ...(runsVisualProject(process.env, process.platform)
      ? [
          {
            name: 'visual',
            testMatch: '**/visual.e2e.ts',
            use: browserEndpoint
              ? {
                  connectOptions: {
                    wsEndpoint: browserEndpoint,
                    exposeNetwork: '<loopback>',
                  },
                }
              : {},
          },
        ]
      : []),
  ],
  webServer: {
    // Keep structured server output beside Playwright's failure artifacts,
    // one log per app port so concurrent suites never share a file.
    command: `mkdir -p test-results && bun e2e/support/server.ts > test-results/server-${ports.app}.log 2>&1`,
    // Probe through the TLS edge, not the app port: the edge and the mail
    // capture live in the same wrapper process, so a reused server is only
    // accepted when all three listeners are up.
    url: `${origin}/api/health/live`,
    ignoreHTTPSErrors: true,
    name: 'production web',
    timeout: 60_000,
    reuseExistingServer: resolveReuseExistingServer(process.env),
    gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
    env: {
      PORT: String(ports.app),
      E2E_EDGE_PORT: String(ports.edge),
      E2E_MAIL_PORT: String(ports.mail),
      NODE_ENV: 'production',
      // The production configuration refinements must hold: HTTPS public URL,
      // deployment identity, no development credentials, proof route closed.
      PUBLIC_APP_URL: origin,
      APP_VERSION: 'e2e',
      GIT_COMMIT: 'local-e2e',
      ...resolveE2EServices(process.env),
      FOUNDATION_PROOF_ENABLED: 'false',
      LOG_LEVEL: 'info',
      // Production refuses to start without auth configuration. These are
      // inert placeholders: outbound mail is captured by the e2e server and
      // never reaches Resend, and no webhook is ever delivered.
      BETTER_AUTH_SECRET:
        'e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0',
      RESEND_API_KEY: 're_e2e_placeholder_not_a_credential',
      AUTH_EMAIL_FROM: 'Daisy <no-reply@e2e.daisy.invalid>',
      RESEND_WEBHOOK_SECRET: 'whsec_ZTJlLXBsYWNlaG9sZGVyLW5vdC1hLXNlY3JldA==',
    },
  },
});
