import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  publicClips,
  publicIntervals,
  settledByHeartbeat,
} from './public-interval';

setupRitewayBun();

const LAG = 450;
const closed = (startedAtMs: number, endedAtMs: number) => ({
  startedAtMs,
  endedAtMs,
  durationMs: 60_000,
});
const open = (startedAtMs: number) => ({
  startedAtMs,
  endedAtMs: null,
  durationMs: 60_000,
});

describe('publicIntervals', () => {
  test('a committed segment is public past the stamp lag to its end; nothing else is', () => {
    assert({
      given: 'two closed segments with a stretch between them, out of order',
      should: 'give each, sorted, and not the stretch between',
      actual: publicIntervals([closed(50_000, 70_000), closed(0, 40_000)], 0),
      expected: [
        { fromMs: LAG, toMs: 40_000 },
        { fromMs: 50_000 + LAG, toMs: 70_000 },
      ],
    });
    assert({
      given: 'no segments',
      should: 'prove nothing',
      actual: publicIntervals([], 1000),
      expected: [],
    });
  });
  test('an open segment is known only as far as the heartbeat, never past its schedule', () => {
    assert({
      given:
        'an open segment heard from at 10 s; past its schedule; no heartbeat at all',
      should: 'end at the heartbeat, at the schedule, and prove nothing',
      actual: [
        publicIntervals([open(0)], 10_000),
        publicIntervals([open(0)], 90_000),
        publicIntervals([open(0)], null),
      ],
      expected: [
        [{ fromMs: LAG, toMs: 10_000 }],
        [{ fromMs: LAG, toMs: 60_000 }],
        [],
      ],
    });
  });
  test('a late commit proves a stretch; only a commit can', () => {
    const outage = publicIntervals([open(0)], 10_000);
    const afterCommit = publicIntervals([closed(0, 60_000)], 400_000);
    const noCommit = publicIntervals([open(0)], 10_000);
    assert({
      given:
        'an outage, then the segment closing; then the same with no commit',
      should: 'publish the stretch only once history says so',
      actual: [outage[0]?.toMs, afterCommit[0]?.toMs, noCommit[0]?.toMs],
      expected: [10_000, 60_000, 10_000],
    });
  });
  test('a segment no longer than the lag proves nothing', () => {
    assert({
      given: 'a segment as short as the lag',
      should: 'give no interval',
      actual: publicIntervals([closed(0, LAG)], 0),
      expected: [],
    });
  });
});

describe('publicClips', () => {
  const entry = (capturedAtMs: number) => ({
    name: `s${capturedAtMs}`,
    capturedAtMs,
    durationMs: 4000,
  });
  const cuts = (
    ...args: Parameters<typeof publicClips<ReturnType<typeof entry>>>
  ) =>
    publicClips(...args).map((clip) => [
      clip.source.name,
      clip.offsetMs,
      clip.capturedAtMs,
      clip.durationMs,
    ]);
  test('a segment wholly inside stays whole; a straddler keeps its public side', () => {
    assert({
      given: 'segments before, across the start, inside, across the end, after',
      should: 'cut at the boundary, to the millisecond, losing no public media',
      actual: cuts(
        [entry(0), entry(4000), entry(8000), entry(12_000), entry(16_000)],
        [{ fromMs: 5000, toMs: 13_500 }],
      ),
      expected: [
        ['s4000', 1000, 5000, 3000],
        ['s8000', 0, 8000, 4000],
        ['s12000', 0, 12_000, 1500],
      ],
    });
  });
  test('one segment across a short stretch gives two clips, and no sliver', () => {
    assert({
      given: 'two intervals inside one segment, then one touching it by 100 ms',
      should: 'give two clips, then none',
      actual: [
        cuts(
          [entry(0)],
          [
            { fromMs: 500, toMs: 1500 },
            { fromMs: 2500, toMs: 3500 },
          ],
        ),
        cuts([entry(0)], [{ fromMs: 3900, toMs: 9000 }]),
      ],
      expected: [
        [
          ['s0', 500, 500, 1000],
          ['s0', 2500, 2500, 1000],
        ],
        [],
      ],
    });
  });
});

describe('settledByHeartbeat', () => {
  test('history is settled only past the media and its margin', () => {
    const segment = { capturedAtMs: 0, durationMs: 4000 };
    assert({
      given: 'no heartbeat; one short of it; one at it',
      should: 'settle only the last',
      actual: [
        settledByHeartbeat(segment, null),
        settledByHeartbeat(segment, 4000 + LAG - 1),
        settledByHeartbeat(segment, 4000 + LAG),
      ],
      expected: [false, false, true],
    });
  });
});
