import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRequestFlagReader } from './reader';

setupRitewayBun();
test('display requests deduplicate their own snapshot and never reuse another subject', async () => {
  const calls: (string | null)[] = [];
  const make = () =>
    createRequestFlagReader({
      read: async (accountId) => {
        calls.push(accountId);
        return {
          snapshot: {
            kind: 'available',
            flags: [
              {
                key: 'premium-checkout',
                revision: 1,
                state: 'disabled',
                override: accountId
                  ? { enabled: true, expiresAt: 1_900_000_000_000 }
                  : null,
              },
            ],
          },
          now: Date.parse('2026-11-05'),
        };
      },
      now: () => Date.parse('2026-11-05'),
      diagnostic: () => {},
    });
  const read = make();
  const values = await Promise.all([
    read('premium-checkout', 'account'),
    read('premium-checkout', 'account'),
    read('premium-checkout', null),
    make()('premium-checkout', 'account'),
  ]);
  assert({
    given: 'concurrent same-subject reads, anonymous read and a new request',
    should: 'deduplicate only within this request and subject',
    actual: { calls, values },
    expected: {
      calls: ['account', null, 'account'],
      values: [true, true, false, true],
    },
  });
});
test('failed display reads close the gate and diagnose once without personal context', async () => {
  let diagnostics = 0;
  const read = createRequestFlagReader({
    read: async () => {
      throw new Error('private database detail');
    },
    now: () => Date.parse('2026-11-05'),
    diagnostic: () => {
      diagnostics += 1;
    },
  });
  const values = await Promise.all([
    read('premium-checkout', 'first'),
    read('premium-checkout', 'second'),
    read('premium-checkout', null),
  ]);
  assert({
    given: 'three failed subject reads in a request',
    should: 'return false with one parameterless diagnostic',
    actual: { values, diagnostics },
    expected: { values: [false, false, false], diagnostics: 1 },
  });
});
