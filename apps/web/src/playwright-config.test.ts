import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import playwrightConfig, {
  resolveBrowserEndpoint,
  resolveE2EPort,
  resolveE2EServices,
  resolveReuseExistingServer,
  runsVisualProject,
} from '../playwright.config';

setupRitewayBun();

describe('Playwright failure artifacts', () => {
  test('retains screenshots and videos alongside the retained trace', () => {
    assert({
      given: 'a failing browser test',
      should: 'retain all diagnostic artifacts for the failure',
      actual: {
        screenshot: playwrightConfig.use?.screenshot,
        video: playwrightConfig.use?.video,
        trace: playwrightConfig.use?.trace,
      },
      expected: {
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        trace: 'retain-on-failure',
      },
    });
  });
});

describe('Playwright port resolution', () => {
  test('defaults to the canonical port', () => {
    assert({
      given: 'an environment without a pinned port',
      should: 'use the canonical e2e port',
      actual: resolveE2EPort({}),
      expected: 3100,
    });
  });

  test('pinned E2E_PORT moves the suite to a parallel session port', () => {
    assert({
      given: 'E2E_PORT from a parallel session slot',
      should: 'derive the server port from it',
      actual: resolveE2EPort({ E2E_PORT: '13100' }),
      expected: 13100,
    });
  });
});

describe('Playwright slot services', () => {
  test('uses exactly the slot database and Redis namespace it is given', () => {
    assert({
      given: 'the e2e values bun slot:up writes for a worktree',
      should: 'pass them to the production server unchanged',
      actual: resolveE2EServices({
        E2E_DATABASE_URL:
          'postgres://daisy_e2e:e2e-loopback-only@localhost:15432/daisy_wt_abc_test',
        E2E_REDIS_URL: 'redis://localhost:6379/2',
        E2E_REDIS_NAMESPACE: 'daisy-wt-abc-e2e',
      }),
      expected: {
        DATABASE_URL:
          'postgres://daisy_e2e:e2e-loopback-only@localhost:15432/daisy_wt_abc_test',
        REDIS_URL: 'redis://localhost:6379/2',
        REDIS_NAMESPACE: 'daisy-wt-abc-e2e',
      },
    });
  });

  test('never falls back to another slot when a value is missing', () => {
    assert({
      given: 'an environment without the e2e slot values',
      should:
        'pass empty values the server configuration rejects, never a default database',
      actual: resolveE2EServices({}),
      expected: { DATABASE_URL: '', REDIS_URL: '', REDIS_NAMESPACE: '' },
    });
  });
});

describe('Playwright server reuse policy', () => {
  test('never reuses an existing server in CI', () => {
    assert({
      given: 'a CI environment',
      should: 'always boot a fresh production server',
      actual: resolveReuseExistingServer({ CI: 'true', E2E_PORT: '13100' }),
      expected: false,
    });
  });

  test('reuses only the unpinned default port locally', () => {
    assert({
      given: 'a local run without a pinned port',
      should: 'reuse an existing server',
      actual: resolveReuseExistingServer({}),
      expected: true,
    });
  });

  test('a pinned port disables reuse so sessions never test foreign code', () => {
    assert({
      given: 'a local run with an explicitly pinned port',
      should: 'fail loud instead of reusing another session server',
      actual: resolveReuseExistingServer({ E2E_PORT: '13100' }),
      expected: false,
    });
  });
});

describe('Playwright visual project', () => {
  test('runs natively on Linux', () => {
    assert({
      given: 'a Linux host with no browser endpoint',
      should: 'include the visual project',
      actual: runsVisualProject({}, 'linux'),
      expected: true,
    });
  });

  test('needs the Linux browser server elsewhere', () => {
    assert({
      given: 'a macOS host without and with a browser endpoint',
      should: 'exclude the project until the Linux browser server is set',
      actual: [
        runsVisualProject({}, 'darwin'),
        runsVisualProject({ PW_WS_ENDPOINT: 'ws://127.0.0.1:3000/' }, 'darwin'),
      ],
      expected: [false, true],
    });
  });

  test('treats an empty endpoint as unset', () => {
    assert({
      given: 'PW_WS_ENDPOINT set to an empty string',
      should: 'resolve no endpoint',
      actual: resolveBrowserEndpoint({ PW_WS_ENDPOINT: '' }),
      expected: undefined,
    });
  });
});

describe('Playwright web server output', () => {
  test('writes one server log per app port', () => {
    const server = Array.isArray(playwrightConfig.webServer)
      ? playwrightConfig.webServer[0]
      : playwrightConfig.webServer;
    assert({
      given: 'the configured e2e web server',
      should: 'log to a file named after its app port, never a shared one',
      actual: server?.command.endsWith(
        `> test-results/server-${server.env?.PORT}.log 2>&1`,
      ),
      expected: true,
    });
  });
});

describe('Playwright web server readiness', () => {
  test('probes the TLS edge the suite uses, so reuse needs the whole wrapper', () => {
    const server = Array.isArray(playwrightConfig.webServer)
      ? playwrightConfig.webServer[0]
      : playwrightConfig.webServer;
    assert({
      given: 'the configured e2e web server',
      should: 'wait for the HTTPS edge origin and accept its test certificate',
      actual: {
        edge: server?.url?.startsWith(`${playwrightConfig.use?.baseURL}/`),
        https: server?.url?.startsWith('https://localhost:'),
        ignoreHTTPSErrors: server?.ignoreHTTPSErrors,
      },
      expected: { edge: true, https: true, ignoreHTTPSErrors: true },
    });
  });
});
