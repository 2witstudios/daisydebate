import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import playwrightConfig, {
  resolveBrowserEndpoint,
  resolveE2EPort,
  resolveE2ERedisPort,
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
  test('defaults to the canonical port and loopback service ports', () => {
    assert({
      given: 'an environment without slot overrides',
      should: 'use the canonical e2e port and local service ports',
      actual: {
        port: resolveE2EPort({}),
        redisPort: resolveE2ERedisPort({}),
      },
      expected: { port: 3100, redisPort: '6379' },
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

  test('pinned E2E_REDIS_PORT moves the e2e Redis endpoint', () => {
    assert({
      given: 'E2E_REDIS_PORT from a parallel session slot',
      should: 'derive the Redis port from it',
      actual: resolveE2ERedisPort({ E2E_REDIS_PORT: '26379' }),
      expected: '26379',
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
