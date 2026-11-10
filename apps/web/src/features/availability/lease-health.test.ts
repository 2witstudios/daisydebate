import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  afterRenewal,
  checkLease,
  startingLease,
  type LeaseHealth,
  type LeaseLapse,
} from './lease-health';
setupRitewayBun();

/** What one second's renewal does: settle after `tookMs`, fail, or hang. */
type Second =
  | { readonly kind: 'renewed'; readonly tookMs: number }
  | { readonly kind: 'failed' }
  | { readonly kind: 'hung' };

const refused = new Error('renewal refused');
const timely: Second = { kind: 'renewed', tookMs: 50 };
const failing: Second = { kind: 'failed' };
const hung: Second = { kind: 'hung' };

/**
 * One tick per second, as the service runs it: check, then start a renewal
 * unless one is still in flight. A renewal settles `tookMs` after its start.
 */
const lapsesOver = (seconds: number, at: (second: number) => Second) => {
  let health: LeaseHealth = startingLease(0);
  let inFlight: {
    readonly startedMs: number;
    readonly settlesMs: number;
    readonly second: Second;
  } | null = null;
  const lapses: (LeaseLapse & { readonly atMs: number })[] = [];
  for (let ms = 0; ms <= seconds * 1000; ms += 50) {
    if (inFlight && ms >= inFlight.settlesMs) {
      health = afterRenewal(
        health,
        inFlight.second.kind === 'renewed'
          ? { kind: 'renewed', startedMs: inFlight.startedMs, settledMs: ms }
          : { kind: 'failed', error: refused },
      );
      inFlight = null;
    }
    if (ms % 1000 !== 0) continue;
    const checked = checkLease(health, ms);
    health = checked.health;
    if (checked.lapse) lapses.push({ ...checked.lapse, atMs: ms });
    if (inFlight) continue;
    const second = at(ms / 1000);
    health = afterRenewal(health, { kind: 'started', startedMs: ms });
    inFlight = {
      startedMs: ms,
      second,
      settlesMs:
        second.kind === 'renewed'
          ? ms + second.tookMs
          : second.kind === 'failed'
            ? ms + 50
            : Number.POSITIVE_INFINITY,
    };
  }
  return lapses;
};

test('a healthy instance never reports', () => {
  assert({
    given: 'a 50 ms renewal every second for an hour',
    should: 'never report',
    actual: lapsesOver(3600, () => timely),
    expected: [],
  });
});

test('one-tick blips cleared by the next renewal never add up', () => {
  assert({
    given:
      'a failed renewal every fifth second, the rest timely, for ten minutes',
    should: 'never report',
    actual: lapsesOver(600, (second) => (second % 5 === 0 ? failing : timely)),
    expected: [],
  });
});

test('slow renewals still prove what they stamped, so a lease they keep current never reports', () => {
  assert({
    given: 'every renewal waiting 2.2 s for admission before it stamps',
    should: 'never report: each proves its call plus the window',
    actual: lapsesOver(120, () => ({ kind: 'renewed', tookMs: 2200 })),
    expected: [],
  });
});

test('a lease left unproven reports after ten seconds, then every five minutes', () => {
  assert({
    given:
      'one timely renewal at start, then failed renewals for eleven minutes',
    should:
      'report when the lease is ten seconds past its window, then 5 and 10 minutes later, with the failure',
    actual: lapsesOver(661, (second) => (second === 0 ? timely : failing)).map(
      ({ atMs, lapsedMs, unproven }) => [atMs, lapsedMs, unproven],
    ),
    expected: [
      [13_000, 10_000, { kind: 'renewal_failed', error: refused }],
      [313_000, 310_000, { kind: 'renewal_failed', error: refused }],
      [613_000, 610_000, { kind: 'renewal_failed', error: refused }],
    ],
  });
});

test('a renewal that hangs after a failure reports as pending, not the stale failure', () => {
  assert({
    given:
      'a timely renewal at start, one failure at 1 s, then a renewal that never settles',
    should: 'report once, as a pending renewal',
    actual: lapsesOver(20, (second) =>
      second === 0 ? timely : second === 1 ? failing : hung,
    ).map(({ atMs, unproven }) => [atMs, unproven]),
    expected: [[13_000, { kind: 'renewal_pending' }]],
  });
});

test('a renewal that settles after a long hang does not report the same lapse twice', () => {
  assert({
    given:
      'a renewal that hangs for a minute from start and then settles, followed by timely renewals',
    should: 'report the lapse once, then go quiet',
    actual: lapsesOver(120, (second) =>
      second === 0 ? { kind: 'renewed', tookMs: 60_000 } : timely,
    ).map(({ atMs }) => atMs),
    expected: [10_000],
  });
});

test('a separate outage after a real recovery reports, even within five minutes', () => {
  assert({
    given:
      'fifteen seconds of failures from start, a minute of timely renewals, then failures from 75 s to 280 s',
    should:
      'report the first lapse, and the second ten seconds after its last proof',
    actual: lapsesOver(300, (second) =>
      second < 15 || (second >= 75 && second < 280) ? failing : timely,
    ).map(({ atMs }) => atMs),
    expected: [10_000, 87_000],
  });
});

test('a recovery shorter than thirty seconds keeps the five-minute limit', () => {
  assert({
    given:
      'failures from start, ten timely seconds at 15 s, then failures again until 200 s',
    should:
      'report only the first lapse, since the lease never truly recovered',
    actual: lapsesOver(200, (second) =>
      second >= 15 && second < 25 ? timely : failing,
    ).map(({ atMs }) => atMs),
    expected: [10_000],
  });
});

test('renewals that each commit 4 s after their call prove nothing, and report as late', () => {
  assert({
    given: 'every renewal settling 4 s after its call, past the 3 s window',
    should: 'report at 10 s that the renewals are late',
    actual: lapsesOver(20, () => ({ kind: 'renewed', tookMs: 4000 })).map(
      ({ atMs, unproven }) => [atMs, unproven],
    ),
    expected: [[10_000, { kind: 'renewal_late', tookMs: 4000 }]],
  });
});

test('a lease that flaps between short recoveries reports at most once in five minutes', () => {
  assert({
    given:
      'renewals that fail except one timely one every twelve seconds, for ten minutes',
    should: 'report no more often than every five minutes',
    actual: lapsesOver(600, (second) => (second % 12 === 0 ? timely : failing))
      .map(({ atMs }, i, all) => (i === 0 ? 0 : atMs - all[i - 1]!.atMs))
      .every((gap) => gap === 0 || gap >= 300_000),
    expected: true,
  });
});

test('a stalled process that started no renewal is named as such, not a hung renewal', () => {
  const proven = afterRenewal(
    afterRenewal(startingLease(0), { kind: 'started', startedMs: 0 }),
    { kind: 'renewed', startedMs: 0, settledMs: 50 },
  );
  assert({
    given:
      'a timely renewal at start, then no tick for thirteen seconds (a stalled timer)',
    should: 'report the lapse as no renewal started',
    actual: checkLease(proven, 13_000).lapse,
    expected: { lapsedMs: 10_000, unproven: { kind: 'renewal_not_started' } },
  });
});
