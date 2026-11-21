import { instantMs } from '@daisy/clock';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRequestFlagReader } from './reader';
import { releaseAdmission } from './admission';

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
          now: instantMs('2026-11-05T00:00:00Z'),
        };
      },
      now: () => instantMs('2026-11-05T00:00:00Z'),
      diagnostic: () => {},
      releaseDefault: false,
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
    now: () => instantMs('2026-11-05T00:00:00Z'),
    diagnostic: () => {
      diagnostics += 1;
    },
    releaseDefault: false,
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
test('the deployment release default reaches display reads and durable admission alike', async () => {
  const now = instantMs('2026-11-05T00:00:00Z');
  const snapshot = {
    kind: 'available',
    flags: [
      { key: 'daisy-tab', revision: 1, state: 'disabled', override: null },
    ],
  } as const;
  const reader = (releaseDefault: boolean) =>
    createRequestFlagReader({
      read: async () => ({ snapshot, now }),
      now: () => now,
      diagnostic: () => {},
      releaseDefault,
    });
  const display = await Promise.all(
    [true, false].flatMap((releaseDefault) => [
      reader(releaseDefault)('premium-checkout', null),
      reader(releaseDefault)('daisy-tab', null),
    ]),
  );
  const admitted = [true, false].map((releaseDefault) =>
    releaseAdmission('premium-checkout', releaseDefault).decide(snapshot, now),
  );
  assert({
    given:
      'the environment default on, then off, with no row for premium-checkout and a disabled row for daisy-tab',
    should:
      'open the unstored flag in both the display reader and admission only when on, and keep the disabled row off',
    actual: { display, admitted },
    expected: { display: [true, false, false, false], admitted: [true, false] },
  });
});
