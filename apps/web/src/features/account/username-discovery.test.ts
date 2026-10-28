import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  discoverActor,
  usernameDiscoveryBatch,
  usernameDiscoveryWindows,
} from './username-discovery';

setupRitewayBun();

test('every username lookup spends one unit of the one discovery budget first', async () => {
  const calls: unknown[] = [];
  const limiter = {
    consume: async (key: string, rule: unknown) => {
      calls.push(['spend', key, rule]);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
  const discover = discoverActor(limiter, async (username) => {
    calls.push(['lookup', username]);
    return username === 'ada' ? 'b'.repeat(24) : null;
  });
  const actorId = 'a'.repeat(24);
  const spend = usernameDiscoveryWindows.map((rule) => [
    'spend',
    `username-discovery:${actorId}:${rule.windowSeconds}`,
    rule,
  ]);
  const answers = [
    await discover(actorId, 'ada'),
    await discover(actorId, 'nobody'),
  ];
  assert({
    given: 'two lookups by one member, a known name then an unknown one',
    should:
      'spend discovery’s own windows before each lookup, once per name, and answer the actor or null',
    actual: [answers, calls],
    expected: [
      ['b'.repeat(24), null],
      [...spend, ['lookup', 'ada'], ...spend, ['lookup', 'nobody']],
    ],
  });
});

test('a refused discovery spend never reaches the directory', async () => {
  const looked: string[] = [];
  const discover = discoverActor(
    { consume: async () => ({ allowed: false, retryAfterSeconds: 60 }) },
    async (username) => {
      looked.push(username);
      return null;
    },
  );
  let code = '';
  try {
    await discover('a'.repeat(24), 'ada');
  } catch (error) {
    code = (error as { code?: string }).code ?? '';
  }
  assert({
    given: 'a member whose discovery budget is spent',
    should: 'refuse as rate limited before any lookup',
    actual: [code, looked],
    expected: ['RATE_LIMIT', []],
  });
});

test('discovery’s windows are DEC-251’s, fixed', () => {
  assert({
    given: 'the shipped username discovery windows',
    should:
      'be exactly 10 in 10 s, 30 a minute and 600 an hour, and a username batch at most the smallest window',
    actual: [usernameDiscoveryWindows, usernameDiscoveryBatch],
    expected: [
      [
        { max: 10, windowSeconds: 10 },
        { max: 30, windowSeconds: 60 },
        { max: 600, windowSeconds: 3_600 },
      ],
      10,
    ],
  });
});
