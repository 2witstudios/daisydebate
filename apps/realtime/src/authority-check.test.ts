import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import {
  authorityFailureFields,
  boundedAuthorityCheck,
} from './authority-check';
import { deferred } from './outbox-drain.test-support';
import type { IntervalTimers } from './outbox-drain';

setupRitewayBun();
for (const result of ['allow', 'failure', 'late-allow'] as const)
  test(`bounded canonical authority check ${result}`, async () => {
    const read = deferred<boolean>();
    let fire!: () => void;
    let scheduled = 0;
    let cleared = false;
    const handle = {} as ReturnType<typeof setInterval>;
    const timers: IntervalTimers = {
      setInterval: (callback, ms) => {
        fire = callback;
        scheduled = ms;
        return handle;
      },
      clearInterval: (received) => {
        cleared = received === handle;
      },
    };
    const checked = boundedAuthorityCheck({
      check: () =>
        result === 'failure'
          ? Promise.reject(new Error('private adapter failure'))
          : read.promise,
      timers,
      budgetMs: 5_000,
    });
    if (result === 'allow') read.resolve(true);
    if (result === 'late-allow') fire();
    const actual = await checked.then(
      (allowed) => allowed,
      (error: unknown) =>
        error instanceof Error ? error.message : 'unexpected rejection',
    );
    if (result === 'late-allow') read.resolve(true);
    await Promise.resolve();
    assert({
      given:
        'an injected canonical lookup and independently scheduled operational budget',
      should:
        'reject a failure or lateness for the caller to report, preserve prompt allow and release the owned timer',
      actual: [actual, scheduled, cleared],
      expected: [
        {
          allow: true,
          failure: 'private adapter failure',
          'late-allow': 'Authority check budget spent',
        }[result],
        5_000,
        true,
      ],
    });
  });

test('an authority failure names its cause without the raw error', async () => {
  let fire!: () => void;
  const checked = boundedAuthorityCheck({
    check: () => new Promise(() => {}),
    timers: {
      setInterval: (callback) => {
        fire = callback;
        return {} as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {},
    },
    budgetMs: 5_000,
  });
  fire();
  const spent = await checked.catch((error: unknown) => error);
  assert({
    given: 'a lane refusal, the spent budget and a failed read',
    should: 'report the lane, reason and pressure, the budget, or the read',
    actual: [
      authorityFailureFields(
        refuseCapacity({
          lane: 'admission',
          reason: 'expired',
          pressure: { pending: 2, running: 1, oldestAgeMs: 400 },
        }),
      ),
      authorityFailureFields(spent),
      authorityFailureFields(new Error('private adapter failure')),
    ],
    expected: [
      { cause: 'admission.expired', pending: 2, running: 1, oldestAgeMs: 400 },
      { cause: 'budget' },
      { cause: 'read' },
    ],
  });
});
