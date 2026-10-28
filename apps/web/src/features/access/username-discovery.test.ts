import { assert, setupRitewayBun, test } from 'riteway/bun';
import { spendUsernameDiscovery } from './username-discovery';

setupRitewayBun();

test('every username lookup spends the one discovery bucket, whichever feature asks', async () => {
  const spent: unknown[] = [];
  const limiter = {
    consume: async (key: string, rule: unknown) => {
      spent.push([key, rule]);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
  const windows = [
    { max: 10, windowSeconds: 10 },
    { max: 600, windowSeconds: 3_600 },
  ];
  await spendUsernameDiscovery(limiter, 'a'.repeat(24), windows);
  assert({
    given: 'one lookup under two windows',
    should: 'spend each window of the member’s shared discovery bucket',
    actual: spent,
    expected: [
      [`username-discovery:${'a'.repeat(24)}:10`, windows[0]],
      [`username-discovery:${'a'.repeat(24)}:3600`, windows[1]],
    ],
  });
});
