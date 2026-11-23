import { virtualClock } from '@daisy/clock/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import {
  authorityFailureFields,
  boundedAuthorityCheck,
} from './authority-check';
import { deferred } from './outbox-drain.test-support';

setupRitewayBun();
for (const result of ['allow', 'failure', 'late-allow'] as const)
  test(`bounded canonical authority check ${result}`, async () => {
    const read = deferred<boolean>();
    const clock = virtualClock();
    let scheduled = 0;
    const waits = {
      ...clock,
      sleep: (ms: number, signal?: AbortSignal) => {
        scheduled = ms;
        return clock.sleep(ms, signal);
      },
    };
    const checked = boundedAuthorityCheck({
      check: () =>
        result === 'failure'
          ? Promise.reject(new Error('private adapter failure'))
          : read.promise,
      waits,
      budgetMs: 5_000,
    });
    if (result === 'allow') read.resolve(true);
    const outcome = checked.then(
      (allowed) => allowed,
      (error: unknown) =>
        error instanceof Error ? error.message : 'unexpected rejection',
    );
    if (result === 'late-allow') await clock.advance(5_000);
    const actual = await outcome;
    if (result === 'late-allow') read.resolve(true);
    await clock.settle();
    // The owned budget wait is released once the check settles.
    const cleared = clock.sleepers() === 0;
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
  const clock = virtualClock();
  const checked = boundedAuthorityCheck({
    check: () => new Promise(() => {}),
    waits: clock,
    budgetMs: 5_000,
  });
  const rejection = checked.catch((error: unknown) => error);
  await clock.advance(5_000);
  const spent = await rejection;
  assert({
    given: 'a lane refusal, the spent budget, a code bug and a lock timeout',
    should:
      'report the lane, reason and pressure, the budget, a code bug, or what the database said',
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
      authorityFailureFields(
        Object.assign(new Error('private text'), { errno: '55P03' }),
      ),
    ],
    expected: [
      { cause: 'admission.expired', pending: 2, running: 1, oldestAgeMs: 400 },
      { cause: 'budget' },
      { cause: 'internal' },
      { cause: 'lock_timeout' },
    ],
  });
});
