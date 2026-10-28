import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  spendUsernameDiscovery,
  usernameDiscoveryWindows,
} from './username-discovery';

setupRitewayBun();

test('every username lookup drains the one discovery budget under its own windows', async () => {
  const counters = new Map<string, number>();
  const rules = new Set<string>();
  const limiter = {
    consume: async (
      key: string,
      rule: { max: number; windowSeconds: number },
    ) => {
      counters.set(key, (counters.get(key) ?? 0) + 1);
      rules.add(JSON.stringify([key, rule]));
      return { allowed: counters.get(key)! <= rule.max, retryAfterSeconds: 0 };
    },
  };
  const actorId = 'a'.repeat(24);
  // A DM request by username and a block by username, from the same member.
  await spendUsernameDiscovery(limiter, actorId);
  await spendUsernameDiscovery(limiter, actorId);
  assert({
    given: 'two lookups from different features by one member',
    should:
      'count both against the same counters, each checked against discovery’s one window set',
    actual: [
      [...counters.entries()],
      rules.size,
      usernameDiscoveryWindows.length,
    ],
    expected: [
      usernameDiscoveryWindows.map((rule) => [
        `username-discovery:${actorId}:${rule.windowSeconds}`,
        2,
      ]),
      usernameDiscoveryWindows.length,
      3,
    ],
  });
});
