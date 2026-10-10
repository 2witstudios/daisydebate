import { assert, setupRitewayBun, test } from 'riteway/bun';
import { boundedAuthorityCheck } from './authority-check';
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
      denied: false,
      timers,
      budgetMs: 5_000,
    });
    if (result === 'allow') read.resolve(true);
    if (result === 'late-allow') fire();
    const actual = await checked;
    if (result === 'late-allow') read.resolve(true);
    await Promise.resolve();
    assert({
      given:
        'an injected canonical lookup and independently scheduled operational budget',
      should:
        'deny failure or lateness, preserve prompt allow and release the owned timer',
      actual: [actual, scheduled, cleared],
      expected: [result === 'allow', 5_000, true],
    });
  });
