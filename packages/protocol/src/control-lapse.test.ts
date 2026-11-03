import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { coveredByHeartbeat, outsideControlLapses } from './control-lapse';

setupRitewayBun();

const segment = (capturedAtMs: number) => ({
  capturedAtMs,
  durationMs: 4000,
});
const lapse = { fromMs: 100_000, toMs: 120_000 };

describe('outsideControlLapses', () => {
  test('media before the last heartbeat stays; after it never, a straddler whole', () => {
    const kept = (at: number) =>
      outsideControlLapses([segment(at)], [lapse]).length === 1;
    assert({
      given:
        'ending a margin before the lapse; ending inside the margin; straddling its start; inside; straddling its end; a margin after',
      should: 'keep only the first and the last',
      actual: [
        kept(95_000),
        kept(95_500),
        kept(98_000),
        kept(110_000),
        kept(119_500),
        kept(121_000),
      ],
      expected: [true, false, false, false, false, true],
    });
  });
  test('a later lapse never removes what the heartbeat had already passed', () => {
    const released = segment(90_000);
    const heartbeatMs = 95_000;
    assert({
      given:
        'a segment the heartbeat covered, then a lapse starting at that heartbeat',
      should: 'leave it in place, so release positions stay stable',
      actual: [
        coveredByHeartbeat(released, heartbeatMs),
        outsideControlLapses(
          [released],
          [{ fromMs: heartbeatMs, toMs: 200_000 }],
        ),
      ],
      expected: [true, [released]],
    });
  });
});

describe('coveredByHeartbeat', () => {
  test('waits for the heartbeat to pass the whole segment', () => {
    assert({
      given: 'no heartbeat; one short of the end plus margin; one at it',
      should: 'cover only the last',
      actual: [
        coveredByHeartbeat(segment(0), null),
        coveredByHeartbeat(segment(0), 4999),
        coveredByHeartbeat(segment(0), 5000),
      ],
      expected: [false, false, true],
    });
  });
});
