import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../playwright.config';
import { expect, test } from './support/fixtures';

/**
 * ISSUE-1008: browser capture works from runtime configuration alone. The
 * production build under this suite is made with no DSN in its environment,
 * as the deployed image is. A second production server over that same build
 * receives the DSN only as a process variable, as a deploy secret does.
 * Sentry itself is not contacted: its capture origin is answered here, after
 * the page's own CSP has admitted the request.
 */
const CAPTURE_ORIGIN = 'https://sentry.e2e.invalid';
const ENVIRONMENT = 'browser-capture-proof';
const SECRET_TEXT = 'raw exception text';
const webDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const freePort = () =>
  new Promise<number>((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === 'object' && address
          ? resolvePort(address.port)
          : reject(new Error('No free port')),
      );
    });
  });

const productionWebEnv = () => {
  const servers = [config.webServer].flat();
  const web = servers.find((server) => server?.name === 'production web');
  if (!web?.env) throw new Error('Production web server config is missing');
  return web.env;
};

test.describe('browser capture from runtime configuration', () => {
  let server: ChildProcess | undefined;
  let origin = '';

  test.beforeAll(async () => {
    test.setTimeout(90_000);
    const [app, edge, mail, feed] = await Promise.all([
      freePort(),
      freePort(),
      freePort(),
      freePort(),
    ]);
    origin = `https://localhost:${edge}`;
    server = spawn('bun', ['e2e/support/server.ts'], {
      cwd: webDirectory,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...productionWebEnv(),
        PORT: String(app),
        E2E_EDGE_PORT: String(edge),
        E2E_MAIL_PORT: String(mail),
        E2E_FEED_PORT: String(feed),
        PUBLIC_APP_URL: origin,
        NEXT_PUBLIC_SENTRY_DSN: `https://publickey@${new URL(CAPTURE_ORIGIN).host}/1`,
        SENTRY_ENVIRONMENT: ENVIRONMENT,
      },
    });
    await expect
      .poll(
        () =>
          fetch(`http://127.0.0.1:${app}/api/health/ready`).then(
            ({ status }) => status,
            () => 0,
          ),
        { timeout: 80_000, intervals: [500] },
      )
      .toBe(200);
  });

  test.afterAll(async () => {
    const running = server;
    if (!running || running.exitCode !== null) return;
    const exited = new Promise((done) => running.once('exit', done));
    running.kill('SIGTERM');
    await exited;
  });

  test('an uncaught browser error reaches the capture origin, scrubbed and tagged', async ({
    page,
  }) => {
    const envelopes: string[] = [];
    await page.route(`${CAPTURE_ORIGIN}/**`, async (route) => {
      envelopes.push(route.request().postData() ?? '');
      await route.fulfill({ status: 200, json: {} });
    });
    await page.goto(`${origin}/`);
    await page.evaluate((message) => {
      setTimeout(() => {
        throw new Error(message);
      });
    }, SECRET_TEXT);
    const errorEvent = () =>
      envelopes.find((envelope) => envelope.includes('"exception"')) ?? '';
    await expect.poll(errorEvent, { timeout: 15_000 }).not.toBe('');
    expect(errorEvent()).toContain(`"environment":"${ENVIRONMENT}"`);
    expect(errorEvent()).not.toContain(SECRET_TEXT);
  });
});

test('an unconfigured deployment names no capture settings on the page', async ({
  page,
}) => {
  await page.goto('/');
  const dataset = await page.evaluate(() => ({
    ...document.documentElement.dataset,
  }));
  expect(Object.keys(dataset)).not.toContain('sentryDsn');
  expect(Object.keys(dataset)).not.toContain('sentryEnvironment');
});
