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
    if (checked.due) {
      lapses.push({ ...checked.due.lapse, atMs: ms });
      health = delivered(delivered(health, 'log', ms), 'report', ms);
    }
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
    expected: [[10_000, { kind: 'renewal_late' }]],
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

const provenAtStart = () =>
  afterRenewal(
    afterRenewal(startingLease(0), { kind: 'started', startedMs: 0 }),
    { kind: 'renewed', startedMs: 0, settledMs: 50 },
  );

test('the check right after a stall tells no one, so a renewal that then proves the lease is never a page', () => {
  const resumed = checkLease(provenAtStart(), 10_500);
  const renewed = afterRenewal(
    afterRenewal(resumed.health, { kind: 'started', startedMs: 10_500 }),
    { kind: 'renewed', startedMs: 10_500, settledMs: 10_550 },
  );
  assert({
    given:
      'a timely renewal at start, a 10.5 s stall, then a renewal that settles 50 ms after the tick resumes',
    should: 'report nothing, on the resumed check or the next',
    actual: [resumed.due, checkLease(renewed, 11_500).due],
    expected: [null, null],
  });
});

test('a stalled process is named as such, whatever renewal it has started since', () => {
  const nextTick = (startedMs: number | null) => {
    const resumed = checkLease(provenAtStart(), 13_000).health;
    const health =
      startedMs === null
        ? resumed
        : afterRenewal(resumed, { kind: 'started', startedMs });
    return checkLease(health, 14_000).due?.lapse.unproven.kind;
  };
  assert({
    given:
      'a timely renewal at start, a thirteen-second stall, and the tick after it: with nothing in flight, a renewal started on resuming, and one in flight through the stall',
    should: 'report each lapse as a stalled process, not a hung renewal',
    actual: [nextTick(null), nextTick(13_000), nextTick(500)],
    expected: ['process_stalled', 'process_stalled', 'process_stalled'],
  });
});

test('a renewal hung while the process keeps checking is named a pending renewal', () => {
  let health = afterRenewal(provenAtStart(), {
    kind: 'started',
    startedMs: 1000,
  });
  for (let ms = 1000; ms < 13_000; ms += 1000)
    health = checkLease(health, ms).health;
  assert({
    given: 'a renewal started at 1 s that never settles, checked every second',
    should: 'report the lapse at 13 s as a pending renewal',
    actual: checkLease(health, 13_000).due?.lapse.unproven,
    expected: { kind: 'renewal_pending' },
  });
});

test('a lapse is due on a channel only until that channel delivers', () => {
  let health = provenAtStart();
  for (let ms = 1000; ms <= 13_000; ms += 1000)
    health = checkLease(health, ms).health;
  const logged = delivered(health, 'log', 13_000);
  const next = checkLease(logged, 14_000).due;
  assert({
    given: 'a due lapse whose log went out at 13 s but whose report did not',
    should: 'be due at 14 s on the report alone',
    actual: next && { log: next.log, report: next.report },
    expected: { log: false, report: true },
  });
});

test('a renewal failing after a stall names the failure, not the stall', () => {
  let health = startingLease(0);
  const why = { kind: 'renewal_failed', error: refused } as const;
  for (let ms = 1000; ms <= 20_000; ms += 1000) {
    health = checkLease(health, ms).health;
    health = afterRenewal(health, { kind: 'failed', error: refused });
  }
  health = checkLease(health, 23_500).health;
  health = afterRenewal(health, { kind: 'failed', error: refused });
  assert({
    given:
      'renewals failing from start, one 3.5 s stall at 20 s, then a renewal that fails again',
    should: 'report the lapse as the renewal failure',
    actual: checkLease(health, 24_500).due?.lapse.unproven,
    expected: why,
  });
});

test('a process that keeps stalling still reports', () => {
  let health = startingLease(0);
  const dues: number[] = [];
  for (let ms = 3200; ms <= 60_000; ms += 3200) {
    const checked = checkLease(health, ms);
    health = checked.health;
    if (checked.due) {
      dues.push(ms);
      health = delivered(delivered(health, 'log', ms), 'report', ms);
    }
    health = afterRenewal(health, { kind: 'failed', error: refused });
  }
  assert({
    given: 'a loop starved to one tick every 3.2 s, with every renewal failing',
    should: 'report the lapse once, not skip every check as just resumed',
    actual: dues.length,
    expected: 1,
  });
});
