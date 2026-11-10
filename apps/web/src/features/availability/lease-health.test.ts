import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  afterRenewal,
  checkLease,
  delivered,
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
 * Every due streak is told on both channels.
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
    const due = checkLease(health, ms);
    if (due) {
      lapses.push({ ...due.lapse, atMs: ms });
      health = delivered(delivered(health, 'log'), 'report');
    }
    if (inFlight) continue;
    const second = at(ms / 1000);
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

test('one-tick blips cleared by the next renewal never report', () => {
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

test('a streak is reported once, past the bound, with its cause and duration', () => {
  assert({
    given:
      'one timely renewal at start, then failed renewals for eleven minutes',
    should:
      'report once, ten seconds past the window, with the renewal failure, and never again in the streak',
    actual: lapsesOver(661, (second) => (second === 0 ? timely : failing)).map(
      ({ atMs, lapsedMs, unproven }) => [atMs, lapsedMs, unproven],
    ),
    expected: [[13_000, 10_000, { kind: 'renewal_failed', error: refused }]],
  });
});

test('a renewal that hangs is a lapse, checked by the tick alone', () => {
  assert({
    given: 'one timely renewal at start and then no renewal ever settling',
    should: 'report once, as a pending renewal',
    actual: lapsesOver(60, (second) => (second === 0 ? timely : hung)).map(
      ({ atMs, unproven }) => [atMs, unproven],
    ),
    expected: [[13_000, { kind: 'renewal_pending' }]],
  });
});

test('renewals that each commit 4 s after their call prove nothing, and report as late', () => {
  assert({
    given: 'every renewal settling 4 s after its call, past the 3 s window',
    should: 'report once at 10 s that the renewals are late',
    actual: lapsesOver(60, () => ({ kind: 'renewed', tookMs: 4000 })).map(
      ({ atMs, unproven }) => [atMs, unproven],
    ),
    expected: [[10_000, { kind: 'renewal_late' }]],
  });
});

test('a renewal that proves the lease again re-arms the streak', () => {
  assert({
    given:
      'fifteen seconds of failures from start, timely renewals, then failures again from 75 s',
    should: 'report each streak once',
    actual: lapsesOver(120, (second) =>
      second < 15 || second >= 75 ? failing : timely,
    ).map(({ atMs }) => atMs),
    expected: [10_000, 87_000],
  });
});

test('a streak owes only the channels it has not yet told', () => {
  const health = afterRenewal(startingLease(0), {
    kind: 'renewed',
    startedMs: 0,
    settledMs: 50,
  });
  const logged = delivered(health, 'log');
  const due = checkLease(logged, 13_000);
  assert({
    given:
      'a streak past the bound whose log went out but whose report did not',
    should: 'owe the report alone, and nothing once both went out',
    actual: [
      due && { log: due.log, report: due.report },
      checkLease(delivered(logged, 'report'), 14_000),
    ],
    expected: [{ log: false, report: true }, null],
  });
});
