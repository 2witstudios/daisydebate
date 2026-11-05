import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isReleaseEnabled } from '../src/features/flags/server';
import { createRequestFlagReader } from '../src/features/flags/reader';
import { createTestApp } from './fixtures';

requireTestServices(process.env);
setupRitewayBun();
const { app } = createTestApp();

test('the public server reader uses allowed injected request composition and deduplicates real PostgreSQL reads', async () => {
  let reads = 0;
  const request = () =>
    createRequestFlagReader({
      read: (accountId, keys) => {
        reads++;
        return app.database.readFlagSnapshot(accountId, keys);
      },
      now: () => Date.parse(app.clock.now()),
      diagnostic: () => {},
    });
  const first = request();
  const values = await Promise.all([
    isReleaseEnabled('premium-checkout', null, first),
    isReleaseEnabled('premium-checkout', null, first),
  ]);
  const firstReads = reads;
  const next = await isReleaseEnabled('premium-checkout', null, request());
  assert({
    given:
      'two reads in one request and then a fresh request over the actual app database',
    should: 'return presentation booleans with one PostgreSQL read per request',
    actual: { values, firstReads, next, totalReads: reads },
    expected: {
      values: [false, false],
      firstReads: 1,
      next: false,
      totalReads: 2,
    },
  });
});
