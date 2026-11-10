import { createRefusal } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  currentLease,
  nextServiceLease,
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

test('the instance reports a lasting lapse once, under one route', () => {
  let nowMs = 0;
  const captured: unknown[][] = [];
  const lease = serviceLease({
    now: () => nowMs,
    reporter: { capture: (...call) => captured.push(call) },
    nextId: () => 'r4n6p8r2t4v6x8z1k3b5c7d9',
  });
  const lapse = createRefusal('AUTHORIZATION', 'service-lease-lapsed');
  for (; nowMs <= 12_000; nowMs += 500) lease.lapseRefused(lapse);
  assert({
    given: 'worker lapse refusals every 500 ms for twelve seconds',
    should: 'capture the refusal once under the instance lease route',
    actual: captured,
    expected: [
      [
        lapse,
        {
          requestId: 'r4n6p8r2t4v6x8z1k3b5c7d9',
          route: 'web.service-lease.lapsed',
          errorCode: 'AUTHORIZATION',
        },
      ],
    ],
  });
});
