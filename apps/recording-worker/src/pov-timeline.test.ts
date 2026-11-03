import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { povTimeline } from './pov-timeline';

setupRitewayBun();

const piece = (attempt: number, startedAtMs: number, durationMs: number) => ({
  attempt,
  path: `/a${attempt}`,
  startedAtMs,
  durationMs,
  hasAudio: true,
});
const clip = (attempt: number, offsetMs: number, durationMs: number) => ({
  kind: 'media' as const,
  clip: { path: `/a${attempt}`, offsetMs, durationMs, hasAudio: true },
});
const gap = (durationMs: number) => ({ kind: 'gap' as const, durationMs });
const FRAME = { fromMs: 100_000, durationMs: 60_000 };

describe('povTimeline', () => {
  test('a stretch the gate does not pass is slate, however it was captured', () => {
    assert({
      given: 'one Egress across a speech, prep and a speech',
      should: 'keep the speeches, and slate for real time between them',
      actual: povTimeline(
        [piece(1, 90_000, 80_000)],
        [
          { fromMs: 100_000, toMs: 120_000 },
          { fromMs: 140_000, toMs: 160_000 },
        ],
        FRAME,
      ),
      expected: {
        parts: [clip(1, 10_000, 20_000), gap(20_000), clip(1, 50_000, 20_000)],
        gaps: [{ startMs: 20_000, endMs: 40_000, reason: 'not_public' }],
      },
    });
  });
  test('nothing public means nothing to offer, whatever was held', () => {
    assert({
      given: 'held media and no interval at all',
      should: 'answer null, so no private second can be kept',
      actual: povTimeline([piece(1, 100_000, 60_000)], [], FRAME),
      expected: null,
    });
  });
  test('a late start and an early end stay in sync with the composite', () => {
    assert({
      given: 'a debater who joined late and left early',
      should: 'put slate at both ends, so the file is the composite length',
      actual: povTimeline(
        [piece(1, 110_000, 10_000)],
        [{ fromMs: 100_000, toMs: 160_000 }],
        FRAME,
      ),
      expected: {
        parts: [gap(10_000), clip(1, 0, 10_000), gap(40_000)],
        gaps: [
          { startMs: 0, endMs: 10_000, reason: 'capture_restart' },
          { startMs: 20_000, endMs: 60_000, reason: 'capture_restart' },
        ],
      },
    });
  });
  test('attempts join with their gap stated, and overlap never repeats', () => {
    assert({
      given: 'a restart with a gap, then one overlapping the last by 1 s',
      should:
        'state the gap as a restart and start the third where the second ended',
      actual: povTimeline(
        [
          piece(1, 100_000, 10_000),
          piece(2, 115_000, 10_000),
          piece(3, 124_000, 36_000),
        ],
        [{ fromMs: 100_000, toMs: 160_000 }],
        FRAME,
      ),
      expected: {
        parts: [
          clip(1, 0, 10_000),
          gap(5000),
          clip(2, 0, 10_000),
          clip(3, 1000, 35_000),
        ],
        gaps: [{ startMs: 10_000, endMs: 15_000, reason: 'capture_restart' }],
      },
    });
  });
  test('a view reaching past the composite is cut to it', () => {
    assert({
      given: 'media before the first frame and after the last',
      should: 'keep only the frame',
      actual: povTimeline(
        [piece(1, 90_000, 90_000)],
        [{ fromMs: 0, toMs: 200_000 }],
        FRAME,
      )?.parts,
      expected: [clip(1, 10_000, 60_000)],
    });
  });
});
