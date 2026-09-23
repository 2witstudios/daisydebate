import { defineConfig, devices } from '@playwright/test';

type Env = Readonly<Record<string, string | undefined>>;

// The signup/login/passkey/recovery journey specs (AUTH-6.6's "supported
// magic-link/account journeys"), run across every engine and mobile layout.
// Non-auth suites (dashboard shell, theme, CSP, foundation proof) stay
// Chromium-only: cross-browser parity for them is outside this epic's scope.
export const AUTH_JOURNEY_SPECS = [
  '**/journey.e2e.ts',
  '**/passkey-lifecycle.e2e.ts',
  '**/accessibility.e2e.ts',
  '**/auth-routes.e2e.ts',
];
// Passkey autofill completes only where the virtual authenticator answers a
// conditional request without browser UI: the mobile-emulated Chromium.
const PASSKEY_AUTOFILL_SPEC = '**/passkey-autofill.e2e.ts';

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
// A reused server keeps whatever database and namespace it was started with
// and ignores webServer.env, so any explicit port or slot setting forces a
// fresh server: only a fully unconfigured local run may reuse. CI never
// reuses.
export const resolveReuseExistingServer = (env: Env): boolean =>
  !env.CI &&
  [
    env.E2E_PORT,
    env.E2E_DATABASE_URL,
    env.E2E_REDIS_URL,
    env.E2E_REDIS_NAMESPACE,
  ].every((value) => value === undefined);

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
  // Release qualification requires retries disabled: a retry-pass is a
  // flaky result, not proof (spec "Prevent tests from proving their own
  // fixtures"). CI always writes the json reporter so
  // scripts/e2e-report-counts.ts can report discovered/executed/pass/fail
  // counts and reject an empty selection.
  retries: 0,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never' }],
        ['json', { outputFile: 'test-results/results.json' }],
      ]
    : 'list',
  use: {
    baseURL: origin,
    // The edge presents a per-run self-signed certificate for localhost.
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // Chromium carries the whole functional suite (app/dashboard chrome,
    // theme, CSP, auth) as the primary CI project, unchanged from before
    // AUTH-6.6. The spec's cross-browser/mobile requirement is scoped to
    // "the supported magic-link/account journeys", not the whole app, so
    // the added engines/layouts below testMatch only the auth-journey
    // specs. CDP WebAuthn (navigator.credentials via a virtual
    // authenticator) is Chromium-only, so passkey-lifecycle.e2e.ts is
    // additionally excluded from every non-Chromium project.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/visual.e2e.ts', PASSKEY_AUTOFILL_SPEC],
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 8'] },
      testMatch: [...AUTH_JOURNEY_SPECS, PASSKEY_AUTOFILL_SPEC],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testMatch: AUTH_JOURNEY_SPECS,
      testIgnore: '**/passkey-lifecycle.e2e.ts',
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: AUTH_JOURNEY_SPECS,
      testIgnore: '**/passkey-lifecycle.e2e.ts',
    },
    {
      name: 'webkit-mobile',
      use: { ...devices['iPhone 15'] },
      testMatch: AUTH_JOURNEY_SPECS,
      testIgnore: '**/passkey-lifecycle.e2e.ts',
    },
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
