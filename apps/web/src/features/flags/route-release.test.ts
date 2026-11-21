import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { App } from '../../server/app';
import { routeReleaseFor } from './route-release';

setupRitewayBun();

test('a failed release snapshot and malformed clock close the route', async () => {
  const app = {
    clock: { now: () => 'invalid' },
    config: { DAISY_RELEASE_FLAG_DEFAULT: 'enabled' },
    database: {
      readFlagSnapshot: async () => {
        throw new Error('snapshot unavailable');
      },
    },
    logger: { log() {} },
  } as unknown as App;
  assert({
    given:
      'a missing snapshot and an invalid injected clock on a release route',
    should: 'return a closed decision even with the deployment default enabled',
    actual: await routeReleaseFor(app)('parental-controls', null),
    expected: false,
  });
});
