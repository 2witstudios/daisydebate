import { createRefusal, isAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  currentLease,
  nextServiceLease,
  renewalSignal,
  serviceLease,
  type ServiceLeaseSignal,
  type ServiceLeaseState,
} from './service-lease';
setupRitewayBun();

/** The instants at which these signals would report. */
const reportsAt = (
  signals: readonly (readonly [ServiceLeaseSignal, number])[],
) => {
  let state: ServiceLeaseState = currentLease;
  const at: number[] = [];
  for (const [signal, nowMs] of signals) {
    const next = nextServiceLease(state, signal, nowMs);
    state = next.state;
    if (next.report) at.push(nowMs);
  }
  return at;
};

const every = (
  signal: ServiceLeaseSignal,
  fromMs: number,
  toMs: number,
  stepMs: number,
) =>
  Array.from(
    { length: Math.floor((toMs - fromMs) / stepMs) + 1 },
    (_, i) => [signal, fromMs + i * stepMs] as const,
  );

test('a lapse the next renewal clears never reports, however many workers saw it', () => {
  assert({
    given:
      'a thousand lapse refusals in one second, then a successful renewal, twice twenty seconds apart',
    should: 'never report',
    actual: reportsAt([
      ...every('lapse-refused', 0, 999, 1),
      ['renewed', 1000],
      ...every('lapse-refused', 20_000, 20_999, 1),
      ['renewed', 21_000],
    ]),
    expected: [],
  });
});

test('a lease that stays lapsing reports after ten seconds, then every five minutes', () => {
  assert({
    given: 'failed renewals every second for eleven minutes',
    should: 'report at 10 s, then 5 and 10 minutes after',
    actual: reportsAt(every('renewal-failed', 0, 660_000, 1000)),
    expected: [10_000, 310_000, 610_000],
  });
});

test('a renewal ends the lapse, so a later one reports afresh', () => {
  assert({
    given:
      'twelve seconds of failed renewals, a renewal, then twelve more seconds of worker lapses',
    should: 'report each lapse once, ten seconds into it',
    actual: reportsAt([
      ...every('renewal-failed', 0, 12_000, 1000),
      ['renewed', 13_000],
      ...every('lapse-refused', 14_000, 26_000, 500),
    ]),
    expected: [10_000, 24_000],
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

test('renewals that each take 4 s while workers refuse still report after 10 s', () => {
  let nowMs = 0;
  const captured: unknown[] = [];
  const lease = serviceLease({
    now: () => nowMs,
    reporter: { capture: (error) => captured.push(error) },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
  });
  const lapse = createRefusal('AUTHORIZATION', 'service-lease-lapsed');
  const reportedAt: number[] = [];
  for (; nowMs <= 20_000; nowMs += 500) {
    lease.lapseRefused(lapse);
    if (nowMs % 4000 === 0 && nowMs > 0) lease.renewed(4000);
    if (captured.length > reportedAt.length) reportedAt.push(nowMs);
  }
  assert({
    given:
      'a renewal settling every 4 s, each 4 s after it was called, and worker refusals every 500 ms',
    should:
      'treat each late renewal as no proof of a current lease and report at 10 s',
    actual: reportedAt,
    expected: [10_000],
  });
});

test('a renewal counts as current only if it settled inside the lease window', () => {
  assert({
    given: 'renewals that settled after 0 ms, 2999 ms and 3000 ms',
    should: 'count the first two as renewed and the last as late',
    actual: [0, 2999, 3000].map(renewalSignal),
    expected: ['renewed', 'renewed', 'renewal-late'],
  });
});
