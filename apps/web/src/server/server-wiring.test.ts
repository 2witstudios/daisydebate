import type { Logger } from '@daisy/logger';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { buildHttpServerOptions } from './server-wiring';

setupRitewayBun();

const logger: Logger = { log: () => undefined, child: () => logger };
const secret = 'a'.repeat(32);

describe('buildHttpServerOptions (AUTH-3.8 start.ts wiring, ISSUE-158)', () => {
  test('passes the app config trusted proxies through, not a literal', () => {
    const trustedProxies = ['10.0.0.0/8'];
    const options = buildHttpServerOptions({
      app: { isDraining: () => false, logger },
      authConfig: {
        AUTH_TRUSTED_PROXIES: trustedProxies,
        BETTER_AUTH_SECRET: secret,
      },
      handle: async () => undefined,
    });
    assert({
      given:
        'authConfig.AUTH_TRUSTED_PROXIES set by the validated production config',
      should:
        'be the exact array createHttpServer receives, not a hardcoded []',
      actual: options.trustedProxies,
      expected: trustedProxies,
    });
  });

  test('wires isDraining from the app, not a function that always answers false', () => {
    const app = { isDraining: () => true, logger };
    const options = buildHttpServerOptions({
      app,
      authConfig: { AUTH_TRUSTED_PROXIES: [], BETTER_AUTH_SECRET: secret },
      handle: async () => undefined,
    });
    assert({
      given: "the app's own isDraining",
      should: 'be the exact function createHttpServer receives',
      actual: options.isDraining(),
      expected: true,
    });
    assert({
      given: "the app's own isDraining",
      should: 'be passed by reference, not wrapped or replaced',
      actual: options.isDraining === app.isDraining,
      expected: true,
    });
  });

  test('derives clientIdSubkey from the validated BETTER_AUTH_SECRET', () => {
    const options = buildHttpServerOptions({
      app: { isDraining: () => false, logger },
      authConfig: { AUTH_TRUSTED_PROXIES: [], BETTER_AUTH_SECRET: secret },
      handle: async () => undefined,
    });
    const other = buildHttpServerOptions({
      app: { isDraining: () => false, logger },
      authConfig: {
        AUTH_TRUSTED_PROXIES: [],
        BETTER_AUTH_SECRET: 'b'.repeat(32),
      },
      handle: async () => undefined,
    });
    assert({
      given: 'two different BETTER_AUTH_SECRET values',
      should: 'derive two different, non-empty client id subkeys',
      actual:
        options.clientIdSubkey !== other.clientIdSubkey &&
        options.clientIdSubkey.length > 0,
      expected: true,
    });
  });
});
