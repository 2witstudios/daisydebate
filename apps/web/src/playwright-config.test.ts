import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import playwrightConfig, {
  resolveBrowserEndpoint,
  resolveE2EPort,
  resolveE2EServices,
  resolveRealtimeNamespace,
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

describe('Playwright Chromium TLS', () => {
  test('accepts the edge certificate at the TLS layer in every Chromium project', () => {
    const chromium = (playwrightConfig.projects ?? []).filter((project) =>
      project.name?.startsWith('chromium'),
    );
    assert({
      given:
        'the per-run self-signed edge certificate, which ignoreHTTPSErrors alone answers by restarting requests (ISSUE-21)',
      should: 'launch each Chromium project with certificate errors ignored',
      actual: chromium.map((project) => [
        project.name,
        project.use?.launchOptions?.args?.includes(
          '--ignore-certificate-errors',
        ),
      ]),
      expected: [
        ['chromium', true],
        ['chromium-mobile', true],
      ],
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
          'postgres://daisy_e2e:e2e-loopback-only@localhost:15432/daisy_wt_abc_e2e',
        E2E_REDIS_URL: 'redis://localhost:6379/2',
        E2E_REDIS_NAMESPACE: 'daisy-wt-abc-e2e',
      }),
      expected: {
        DATABASE_URL:
          'postgres://daisy_e2e:e2e-loopback-only@localhost:15432/daisy_wt_abc_e2e',
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

describe('Playwright realtime namespace', () => {
  test('adds a -realtime suffix when it still fits REDIS_NAMESPACE', () => {
    assert({
      given: 'a short e2e slot namespace',
      should: 'append -realtime',
      actual: resolveRealtimeNamespace({
        E2E_REDIS_NAMESPACE: 'daisy-wt-abc-e2e',
      }),
      expected: 'daisy-wt-abc-e2e-realtime',
    });
  });

  test('shares the namespace when a -realtime suffix would exceed the 41-character limit', () => {
    // Matches scripts/slot-model.ts's maxIdLength reasoning: the longest
    // worktree slot's E2E_REDIS_NAMESPACE is already 41 characters.
    const atLimit = `daisy-wt-${'a'.repeat(28)}-e2e`;
    assert({
      given: "a namespace already at REDIS_NAMESPACE's 41-character limit",
      should:
        'fall back to sharing it rather than producing an invalid namespace',
      actual: resolveRealtimeNamespace({ E2E_REDIS_NAMESPACE: atLimit }),
      expected: atLimit,
    });
  });

  test('an empty namespace fails closed rather than producing "-realtime"', () => {
    assert({
      given: 'no e2e slot namespace configured',
      should:
        'resolve to the same empty string resolveE2EServices already produces, never a bare "-realtime"',
      actual: resolveRealtimeNamespace({}),
      expected: '',
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

  test('explicit slot services disable reuse even on the default port', () => {
    assert({
      given:
        'e2e database, Redis URL or namespace settings without a pinned port',
      should: 'boot its own server so those settings are actually applied',
      actual: [
        resolveReuseExistingServer({ E2E_DATABASE_URL: 'postgres://x/y_test' }),
        resolveReuseExistingServer({ E2E_REDIS_URL: 'redis://x/2' }),
        resolveReuseExistingServer({ E2E_REDIS_NAMESPACE: 'daisy-wt-abc-e2e' }),
      ],
      expected: [false, false, false],
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

describe('Playwright realtime web server', () => {
  const realtime = Array.isArray(playwrightConfig.webServer)
    ? playwrightConfig.webServer[1]
    : undefined;

  test('takes its database and Redis from the same slot services as the web server', () => {
    assert({
      given: 'the configured realtime web server',
      should:
        'source DATABASE_URL and REDIS_URL from resolveE2EServices and REDIS_NAMESPACE from resolveRealtimeNamespace',
      actual: {
        databaseUrl: realtime?.env?.DATABASE_URL,
        redisUrl: realtime?.env?.REDIS_URL,
        namespace: realtime?.env?.REDIS_NAMESPACE,
      },
      expected: {
        databaseUrl: resolveE2EServices(process.env).DATABASE_URL,
        redisUrl: resolveE2EServices(process.env).REDIS_URL,
        namespace: resolveRealtimeNamespace(process.env),
      },
    });
  });

  test('logs to a file named after its own port, beside the web server log', () => {
    assert({
      given: 'the configured realtime web server',
      should: 'log to test-results/realtime-<port>.log',
      actual: realtime?.command.includes(
        `test-results/realtime-${realtime?.env?.REALTIME_PORT}.log`,
      ),
      expected: true,
    });
  });

  test('follows the same reuse policy as the web server', () => {
    assert({
      given: 'the configured realtime web server',
      should: 'share resolveReuseExistingServer with the web server',
      actual: realtime?.reuseExistingServer,
      expected: resolveReuseExistingServer(process.env),
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
