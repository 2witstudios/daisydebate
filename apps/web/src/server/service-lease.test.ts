import { createRefusal, isAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  nextServiceLease,
  serviceLease,
  unknownLease,
  type ServiceLeaseSignal,
  type ServiceLeaseState,
} from './service-lease';
setupRitewayBun();

type Timed = readonly [ServiceLeaseSignal, number];
const renewed = (atMs: number, tookMs = 50): Timed => [
  { kind: 'renewed', tookMs },
  atMs,
];
const failed = (atMs: number): Timed => [{ kind: 'renewal-failed' }, atMs];
const refused = (atMs: number): Timed => [{ kind: 'lapse-refused' }, atMs];

/** The instants at which these signals would report. */
const reportsAt = (signals: readonly Timed[]) => {
  let state: ServiceLeaseState = unknownLease;
  const at: number[] = [];
  for (const [signal, nowMs] of signals) {
    const next = nextServiceLease(state, signal, nowMs);
    state = next.state;
    if (next.report) at.push(nowMs);
  }
  return at;
};

const range = (fromMs: number, toMs: number, stepMs: number) =>
  Array.from(
    { length: Math.floor((toMs - fromMs) / stepMs) + 1 },
    (_, i) => fromMs + i * stepMs,
  );

/** A healthy instance: a 50 ms renewal every second. */
const healthy = (fromMs: number, toMs: number) =>
  range(fromMs, toMs, 1000).map((at) => renewed(at));

const inOrder = (signals: readonly Timed[]) =>
  [...signals].sort((a, b) => a[1] - b[1]);

test('a lapse the next renewal clears never reports, however many workers saw it', () => {
  assert({
    given:
      'healthy renewals with a thousand lapse refusals in one second, twice eleven seconds apart',
    should: 'never report',
    actual: reportsAt(
      inOrder([
        ...healthy(0, 40_000),
        ...range(10_000, 10_999, 1).map(refused),
        ...range(21_000, 21_999, 1).map(refused),
      ]),
    ),
    expected: [],
  });
});

test('failed renewals report once the lease is ten seconds past its window, then every five minutes', () => {
  assert({
    given:
      'one renewal at 0 ms, then a failed renewal every second for eleven minutes',
    should:
      'start the lapse when the window ends at about 3 s and report 10 s later, then at +5 and +10 minutes',
    actual: reportsAt([
      renewed(0, 0),
      ...range(1000, 660_000, 1000).map(failed),
    ]),
    expected: [13_000, 313_000, 613_000],
  });
});

test('renewals that alternate with failures never lapse the lease', () => {
  assert({
    given:
      'a renewal every two seconds and a failed renewal between each, for a minute',
    should: 'never report: every stamp is still inside the window',
    actual: reportsAt(
      inOrder([
        ...range(0, 60_000, 2000).map((at) => renewed(at)),
        ...range(1000, 59_000, 2000).map(failed),
      ]),
    ),
    expected: [],
  });
});

test('renewals that each take 4 s while workers refuse still report after 10 s', () => {
  assert({
    given:
      'a renewal settling every 4 s, each 4 s after its call, and worker refusals every 500 ms',
    should: 'treat each late renewal as no proof of a current lease',
    actual: reportsAt(
      inOrder([
        ...range(4000, 20_000, 4000).map((at) => renewed(at, 4000)),
        ...range(0, 20_000, 500).map(refused),
      ]),
    ),
    expected: [10_000],
  });
});

test('a lease that flaps between slow renewals is one lapse, and reports', () => {
  // Each renewal takes 2.9 s and the next starts a second after: the lease
  // is current for 3 s, then lapsed for about 0.9 s, every cycle.
  const cycle = 3900;
  const signals = inOrder([
    ...range(2900, 60_000, cycle).map((at) => renewed(at, 2900)),
    ...range(0, 60_000, cycle).map((at) => refused(at + 3500)),
  ]);
  assert({
    given: 'renewals that each settle after 2.9 s, with a refusal in every gap',
    should: 'report once the flapping has lasted ten seconds',
    actual: reportsAt(signals).length,
    expected: 1,
  });
});

test('the instance reports a lasting lapse once, as one error under one route', () => {
  let nowMs = 0;
  const captured: unknown[][] = [];
  const lease = serviceLease({
    now: () => nowMs,
    reporter: { capture: (...call) => captured.push(call) },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
  });
  const lapse = createRefusal('AUTHORIZATION', 'service-lease-lapsed');
  for (; nowMs <= 12_000; nowMs += 500) lease.lapseRefused(lapse);
  const [error, context] = captured[0] ?? [];
  assert({
    given: 'worker lapse refusals every 500 ms for twelve seconds',
    should:
      'capture once: one infrastructure error caused by the refusal, under the instance lease route',
    actual: {
      reports: captured.length,
      code: isAppError(error) ? error.code : null,
      cause: error instanceof Error ? error.cause : null,
      context,
    },
    expected: {
      reports: 1,
      code: 'INFRASTRUCTURE',
      cause: lapse,
      context: {
        requestId: 'r4n6p8r2t4v6x8z1k3b5c7d9',
        route: 'web.service-lease.lapsed',
        errorCode: 'INFRASTRUCTURE',
      },
    },
  });
});

test('a report that fails to send is retried on the next lapse, not after five minutes', () => {
  let nowMs = 0;
  let attempts = 0;
  const lease = serviceLease({
    now: () => nowMs,
    reporter: {
      capture: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('transport down');
      },
    },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
  });
  const lapse = createRefusal('AUTHORIZATION', 'service-lease-lapsed');
  let thrown: unknown = null;
  try {
    for (; nowMs <= 11_000; nowMs += 500) lease.lapseRefused(lapse);
  } catch (error) {
    thrown = error;
  }
  assert({
    given: 'a reporter that throws on the first report of a lasting lapse',
    should: 'never throw, and send the report on the next lapse',
    actual: { thrown, attempts },
    expected: { thrown: null, attempts: 2 },
  });
});
