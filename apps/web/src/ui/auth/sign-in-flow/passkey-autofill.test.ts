import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { PasskeyAutofillOutcome } from '../sign-in-port';
import {
  AUTOFILL_REFRESH_MS,
  autofillRetryDelayMs,
  startPasskeyAutofill,
  type AutofillTimers,
} from './passkey-autofill';

setupRitewayBun();

/** Timers that only run when the test fires them. */
const fakeTimers = () => {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let next = 0;
  const timers: AutofillTimers = {
    set: (run, ms) => {
      next += 1;
      pending.set(next, { run, ms });
      return next;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    delays: () => [...pending.values()].map(({ ms }) => ms),
    fire: (ms: number) => {
      const entry = [...pending.entries()].find(([, timer]) => timer.ms === ms);
      if (!entry) throw new Error(`no timer pending for ${ms} ms`);
      pending.delete(entry[0]);
      entry[1].run();
    },
  };
};

/** Offers that stay pending until the test settles them, oldest first. */
const scriptedOffers = () => {
  const open: ((outcome: PasskeyAutofillOutcome) => void)[] = [];
  let started = 0;
  return {
    offer: () =>
      new Promise<PasskeyAutofillOutcome>((resolve) => {
        started += 1;
        open.push(resolve);
      }),
    started: () => started,
    settle: async (index: number, kind: PasskeyAutofillOutcome['kind']) => {
      open[index]?.({ kind });
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
};

const run = () => {
  const scheduler = fakeTimers();
  const offers = scriptedOffers();
  const settled: string[] = [];
  const stop = startPasskeyAutofill({
    offer: offers.offer,
    onSettled: (outcome) => settled.push(outcome.kind),
    timers: scheduler.timers,
  });
  return { scheduler, offers, settled, stop };
};

describe('autofillRetryDelayMs', () => {
  test('backs off exponentially up to the refresh interval', () => {
    assert({
      given: 'the first, second, third and a much later retry',
      should: 'wait 1 s, 2 s, 4 s, then no longer than the refresh interval',
      actual: [0, 1, 2, 20].map(autofillRetryDelayMs),
      expected: [1_000, 2_000, 4_000, AUTOFILL_REFRESH_MS],
    });
  });
});

describe('startPasskeyAutofill', () => {
  test('offers at once and refreshes before the challenge expires', async () => {
    const { scheduler, offers, settled } = run();
    const armed = [offers.started(), scheduler.delays()];
    scheduler.fire(AUTOFILL_REFRESH_MS);
    await offers.settle(0, 'superseded');
    assert({
      given: 'an armed email step left idle past the refresh interval',
      should:
        'offer once with a refresh pending, then offer again and ignore the replaced request',
      actual: { armed, started: offers.started(), settled },
      expected: {
        armed: [1, [AUTOFILL_REFRESH_MS]],
        started: 2,
        settled: [],
      },
    });
  });

  test('re-arms after a dismissal or a refused pick, backing off', async () => {
    const { scheduler, offers, settled } = run();
    await offers.settle(0, 'interrupted');
    const afterFirst = scheduler.delays();
    scheduler.fire(1_000);
    await offers.settle(1, 'refused');
    assert({
      given: 'a dismissed prompt, then a pick the server refused',
      should:
        'report both and wait 1 s, then 2 s, before offering again, with no refresh pending meanwhile',
      actual: {
        settled,
        afterFirst,
        afterSecond: scheduler.delays(),
        started: offers.started(),
      },
      expected: {
        settled: ['interrupted', 'refused'],
        afterFirst: [1_000],
        afterSecond: [2_000],
        started: 2,
      },
    });
  });

  test('stops for good when superseded or unavailable', async () => {
    const superseded = run();
    await superseded.offers.settle(0, 'superseded');
    const unavailable = run();
    await unavailable.offers.settle(0, 'unavailable');
    assert({
      given:
        'a request a newer ceremony aborted, and a browser without autofill',
      should: 'report each and schedule nothing further',
      actual: [
        [superseded.settled, superseded.scheduler.delays()],
        [unavailable.settled, unavailable.scheduler.delays()],
      ],
      expected: [
        [['superseded'], []],
        [['unavailable'], []],
      ],
    });
  });

  test('after stopping, drops stale endings but keeps a late sign-in', async () => {
    const first = run();
    first.stop();
    await first.offers.settle(0, 'refused');
    const second = run();
    second.stop();
    await second.offers.settle(0, 'signed-in');
    assert({
      given: 'a stopped loop whose request later ends refused, or signed in',
      should:
        'clear its timers, ignore the refusal, and still report the sign-in the server made',
      actual: [
        [first.settled, first.scheduler.delays()],
        [second.settled, second.scheduler.delays()],
      ],
      expected: [
        [[], []],
        [['signed-in'], []],
      ],
    });
  });
});
