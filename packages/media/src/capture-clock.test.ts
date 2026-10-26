import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCaptureClock } from './capture-clock';
setupRitewayBun();
const calibration = {
  sentAtMs: 0,
  receivedAtMs: 1,
  serverNowMs: 10000,
  precisionMs: 1,
};
const frame = (
  sequence: number,
  beforeMs: number,
  afterMs = beforeMs + 0.1,
) => ({ sequence, beforeMs, afterMs });
const nominalOf = (
  clock: ReturnType<typeof createCaptureClock>,
  frames: readonly ReturnType<typeof frame>[],
) => frames.map((f) => clock.observe(f)?.nominalStartMs ?? null);
/** The calibration a history read returns at local time `at`, its server sample `sample` ms into a `rttMs` round trip. */
const calibrated = (at: number, rttMs: number, sample = 0) => ({
  sentAtMs: at - rttMs,
  receivedAtMs: at,
  serverNowMs: 10000 + at - rttMs + sample,
  precisionMs: 1,
});

test('a track timeline is its frame sequence, whatever the arrival timing (DEC-215)', () => {
  const clock = createCaptureClock(calibration);
  assert({
    given:
      'a first frame, a burst handed over together, a 200 ms stall, then two and five missing sequence numbers',
    should:
      'keep every received frame, advance 10 ms per sequence number and leave exactly 10 ms per missing one',
    actual: nominalOf(clock, [
      frame(0, 10),
      frame(1, 20.2),
      frame(2, 20.4),
      frame(3, 20.6),
      frame(4, 250),
      frame(7, 260),
      frame(13, 270),
    ]),
    expected: [9999, 10009, 10019, 10029, 10039, 10069, 10129],
  });
});

test('every frame bracket contains its nominal frame at any round trip (ISSUE-466-r5)', () => {
  const violations = [10, 50, 100].map((rttMs) => {
    const clock = createCaptureClock(calibrated(150, rttMs));
    let bad = 0;
    for (let sequence = 0; sequence < 300; sequence++) {
      const at = 200 + sequence * 10;
      if (sequence > 0 && sequence % 25 === 0)
        clock.refresh(calibrated(at - 1, rttMs, (sequence * 7) % rttMs));
      const timed = clock.observe(frame(sequence, at + ((sequence * 3) % 4)));
      if (
        !timed ||
        Math.floor(timed.beforeMs) > timed.nominalStartMs ||
        Math.ceil(timed.afterMs) < timed.nominalStartMs + 10
      )
        bad++;
    }
    return bad;
  });
  assert({
    given:
      'three seconds of jittered frames recalibrated every 250 ms under 10, 50 and 100 ms round trips',
    should: 'map every frame with a bracket around its nominal span',
    actual: violations,
    expected: [0, 0, 0],
  });
});

test('no calibration shift at a re-anchor shrinks a sequence gap (ISSUE-466-r6)', () => {
  const gapAfterShift = (missing: number, rttMs: number) => {
    const clock = createCaptureClock(calibrated(150, 2, 1));
    const last = nominalOf(
      clock,
      Array.from({ length: 50 }, (_, i) => frame(i, 200 + i * 10)),
    ).at(-1)!;
    // At the gap a refresh samples the server at the very start of a long round trip.
    clock.refresh(calibrated(200 + 50 * 10, rttMs));
    const next = clock.observe(
      frame(50 + missing, 200 + (50 + missing) * 10),
    )!.nominalStartMs;
    return next - last - 10;
  };
  assert({
    given:
      'a 20 ms dropout under a 30 ms downward offset shift and a 50 ms dropout under a 60 ms one',
    should: 'keep exactly the missing sequence time as the gap',
    actual: [gapAfterShift(2, 32), gapAfterShift(5, 62)],
    expected: [20, 50],
  });
});

test('an unusable calibration maps no run, and its frames stay sequence gaps', () => {
  const clock = createCaptureClock(calibration);
  const first = clock.observe(frame(0, 10))!.nominalStartMs;
  clock.refresh({ ...calibration, receivedAtMs: 150 });
  const refused = clock.observe(frame(2, 30));
  clock.refresh(calibration);
  assert({
    given:
      'a mapped frame, a missing one, one refused under a calibration received after it, then a usable refresh',
    should:
      'refuse that frame and continue the track sequence, leaving the missing and refused frames as a 20 ms gap',
    actual: [refused, clock.observe(frame(3, 40))!.nominalStartMs - first - 10],
    expected: [null, 20],
  });
});

test('a sequence reset on the same track starts a new run (ISSUE-466-r7)', () => {
  const gapAfterReset = (silentMs: number) => {
    const clock = createCaptureClock(calibration);
    const last = nominalOf(
      clock,
      Array.from({ length: 50 }, (_, i) => frame(i, 10 + i * 10)),
    ).at(-1)!;
    const next = clock.observe(frame(0, 10 + 50 * 10 + silentMs))!;
    return next.nominalStartMs - last - 10;
  };
  assert({
    given:
      'a native counter restarting at 0 on the same track at once, and after 500 ms of resubscribing',
    should:
      'never join the old run: leave at least a 10 ms gap, and the clock-measured gap after a pause',
    actual: [gapAfterReset(0) >= 10, gapAfterReset(500) >= 490],
    expected: [true, true],
  });
});
