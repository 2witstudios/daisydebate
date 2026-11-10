import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  afterRenewal,
  checkLease,
  startingLease,
  type LeaseHealth,
  type LeaseLapse,
  type LeaseRenewal,
} from './lease-health';
setupRitewayBun();

/** One tick per second: a renewal settling as `renewalAt(second)` says, then the check. */
const lapsesOver = (
  seconds: number,
  renewalAt: (second: number) => LeaseRenewal | null,
) => {
  let health: LeaseHealth = startingLease(0);
  const lapses: (LeaseLapse & { readonly atMs: number })[] = [];
  for (let second = 1; second <= seconds; second++) {
    const nowMs = second * 1000;
    const renewal = renewalAt(second);
    if (renewal) health = afterRenewal(health, renewal, nowMs);
    const checked = checkLease(health, nowMs);
    health = checked.health;
    if (checked.lapse) lapses.push({ ...checked.lapse, atMs: nowMs });
  }
  return lapses;
};

const timely: LeaseRenewal = { kind: 'renewed', tookMs: 50 };
const refused = new Error('renewal refused');
const failed: LeaseRenewal = { kind: 'failed', error: refused };

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
      'a failed renewal every fifth second, each followed by timely ones, for ten minutes',
    should: 'never report',
    actual: lapsesOver(600, (second) => (second % 5 === 0 ? failed : timely)),
    expected: [],
  });
});

test('a lease left unproven reports after ten seconds, then every five minutes', () => {
  assert({
    given: 'one timely renewal at 1 s, then failed renewals for eleven minutes',
    should:
      'report when the lease is ten seconds past its window, then 5 and 10 minutes later, with the latest failure',
    actual: lapsesOver(661, (second) => (second === 1 ? timely : failed)).map(
      ({ atMs, lapsedMs, lastFailure }) => [atMs, lapsedMs, lastFailure],
    ),
    expected: [
      [14_000, 10_050, refused],
      [314_000, 310_050, refused],
      [614_000, 610_050, refused],
    ],
  });
});

test('a renewal that hangs is a lapse, checked by the tick alone', () => {
  assert({
    given: 'one timely renewal at 1 s and then no renewal ever settling',
    should:
      'report at the first tick ten seconds past the window, with no failure',
    actual: lapsesOver(20, (second) => (second === 1 ? timely : null)).map(
      ({ atMs, lastFailure }) => [atMs, lastFailure],
    ),
    expected: [[14_000, undefined]],
  });
});

test('slow renewals prove nothing, so a lease that flaps between them reports', () => {
  assert({
    given: 'every renewal taking 2.5 s, settling every three seconds',
    should: 'treat none as proof and report ten seconds after start',
    actual: lapsesOver(20, (second) =>
      second % 3 === 0 ? { kind: 'renewed', tookMs: 2500 } : null,
    ).map(({ atMs }) => atMs),
    expected: [10_000],
  });
});

test('a timely renewal ends the lapse, so a later one reports afresh', () => {
  assert({
    given:
      'fifteen seconds of failures from start, a minute of timely renewals, then fifteen more seconds of failures',
    should: 'report each lapse once',
    actual: lapsesOver(90, (second) =>
      second <= 15 || second > 75 ? failed : timely,
    ).map(({ atMs }) => atMs),
    expected: [10_000, 88_000],
  });
});
