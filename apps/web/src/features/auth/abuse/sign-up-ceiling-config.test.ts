import { assert, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../../server/test-loggers.test-support';
import { createSignUpCeiling } from './rate-limit';

setupRitewayBun();

test('configured global ceilings bound sends and reset the daily budget at UTC midnight', async () => {
  const counters = new Map<string, number>();
  let now = '2026-10-26T23:59:59.000Z';
  const spend = createSignUpCeiling({
    logger: silentLogger,
    clock: { now: () => now },
    ceilings: { perMinute: 10, perDay: 2 },
    limiter: {
      consume: async (key, rule) => {
        const count = (counters.get(key) ?? 0) + 1;
        counters.set(key, count);
        return { allowed: count <= rule.max, retryAfterSeconds: 60 };
      },
    },
  });
  const sameDay = [await spend(), await spend(), await spend()];
  now = '2026-10-27T00:00:00.000Z';
  assert({
    given: 'a two-mail daily ceiling spent before midnight and a fresh UTC day',
    should:
      'admit exactly two, refuse excess and admit the next day without resetting the minute counter',
    actual: [sameDay, await spend(), counters.get('auth:magic-link:global:60')],
    expected: [[true, true, false], true, 4],
  });
});

test('configured per-minute ceiling is enforced independently of the day capacity', async () => {
  let count = 0;
  const spend = createSignUpCeiling({
    logger: silentLogger,
    clock: { now: () => '2026-10-26T12:00:00.000Z' },
    ceilings: { perMinute: 2, perDay: 50 },
    limiter: {
      consume: async (key, rule) => ({
        allowed: key.endsWith(':60') ? ++count <= rule.max : true,
        retryAfterSeconds: 60,
      }),
    },
  });
  assert({
    given: 'a configured two-send minute with ample daily capacity',
    should: 'admit the exact limit and refuse the first excess',
    actual: [await spend(), await spend(), await spend()],
    expected: [true, true, false],
  });
});
