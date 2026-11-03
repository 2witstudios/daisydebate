import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  privateSpanChanges,
  publicClips,
  publicIntervals,
  settledByHeartbeat,
  stageTimeline,
  wholeSegmentsInside,
} from './public-interval';

setupRitewayBun();

const LAG = 1200;
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
    entries: readonly ReturnType<typeof entry>[],
    intervals: readonly { fromMs: number; toMs: number }[],
  ) =>
    publicClips(entries, intervals).map((clip) => [
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

describe('stageTimeline', () => {
  const prep = (startedAtMs: number, endedAtMs: number | null) => ({
    kind: 'prep' as const,
    startedAtMs,
    endedAtMs,
  });
  test('speech, the countdown between, and a private span each say what they are', () => {
    assert({
      given: 'a speech, a countdown, a speech, prep, then a speech',
      should:
        'fill the stretch with no span as between, and name prep private, widened out of it',
      actual: stageTimeline({
        segments: [
          closed(0, 10_000),
          closed(20_000, 30_000),
          closed(50_000, 60_000),
        ],
        privateSpans: [prep(35_000, 45_000)],
        knownThroughMs: 90_000,
      }),
      expected: [
        { kind: 'speech', fromMs: LAG, toMs: 10_000 },
        { kind: 'between', fromMs: 10_000, toMs: 20_000 + LAG },
        { kind: 'speech', fromMs: 20_000 + LAG, toMs: 30_000 },
        { kind: 'between', fromMs: 30_000, toMs: 35_000 },
        { kind: 'private', fromMs: 35_000, toMs: 45_000 + LAG },
        { kind: 'between', fromMs: 45_000 + LAG, toMs: 50_000 + LAG },
        { kind: 'speech', fromMs: 50_000 + LAG, toMs: 60_000 },
      ],
    });
  });
  test('what nothing bounds yet has no interval, so it waits', () => {
    assert({
      given: 'a closed speech and no next row: the countdown or anything else',
      should: 'say nothing past the speech',
      actual: stageTimeline({
        segments: [closed(0, 10_000)],
        privateSpans: [],
        knownThroughMs: 15_000,
      }),
      expected: [{ kind: 'speech', fromMs: LAG, toMs: 10_000 }],
    });
  });
  test('an open private span is known only as far as the heartbeat', () => {
    assert({
      given: 'prep still open, heard from at 40 s',
      should: 'end there',
      actual: stageTimeline({
        segments: [],
        privateSpans: [prep(30_000, null)],
        knownThroughMs: 40_000,
      }),
      expected: [{ kind: 'private', fromMs: 30_000, toMs: 40_000 }],
    });
  });
  test('a boundary never gives a private moment a more public kind', () => {
    const timeline = stageTimeline({
      segments: [closed(0, 10_000), closed(20_000, 30_000)],
      privateSpans: [prep(10_000, 20_000)],
      knownThroughMs: 40_000,
    });
    assert({
      given: 'prep exactly between two speeches',
      should:
        'cover every instant of prep, by the lag each way, with no between',
      actual: timeline.map(({ kind }) => kind),
      expected: ['speech', 'private', 'speech'],
    });
  });
});

describe('privateSpanChanges', () => {
  const idle = { stage: 'live', activePrep: null };
  const active = (startedAtMs: number) => ({
    stage: 'live',
    activePrep: { startedAtMs, consumedMs: 5000 },
  });
  test('prep opens at its start, and closes at the time it used', () => {
    assert({
      given: 'prep starting; ending on time; ending where a late tick found it',
      should: 'open at the start, close at the time used, never past now',
      actual: [
        privateSpanChanges(
          idle,
          { ...active(100), consumedNowMs: 5000 },
          200,
          null,
        ),
        privateSpanChanges(
          active(100),
          { ...idle, consumedNowMs: 5050 },
          200,
          null,
        ),
        privateSpanChanges(
          active(100),
          { ...idle, consumedNowMs: 95_000 },
          70_000,
          null,
        ),
      ],
      expected: [
        [{ type: 'open', kind: 'prep', atMs: 100 }],
        [{ type: 'close', kind: 'prep', atMs: 150 }],
        [{ type: 'close', kind: 'prep', atMs: 70_000 }],
      ],
    });
  });
  test('judging opens when the final segment ended, and closes with its stage', () => {
    const judging = { stage: 'awaiting_ballot', activePrep: null };
    assert({
      given:
        'the final segment ended at 500 and committed at 900, then the ballot',
      should: 'open at 500, and close at the commit',
      actual: [
        privateSpanChanges(idle, { ...judging, consumedNowMs: 0 }, 900, 500),
        privateSpanChanges(
          judging,
          { ...idle, stage: null, consumedNowMs: 0 },
          2000,
          null,
        ),
      ],
      expected: [
        [{ type: 'open', kind: 'judging', atMs: 500 }],
        [{ type: 'close', kind: 'judging', atMs: 2000 }],
      ],
    });
  });
  test('nothing else commits', () => {
    assert({
      given: 'a tick with no change of prep or stage',
      should: 'commit nothing',
      actual: privateSpanChanges(idle, { ...idle, consumedNowMs: 0 }, 1, null),
      expected: [],
    });
  });
});

describe('wholeSegmentsInside', () => {
  test('a retained source keeps only what is wholly known public', () => {
    const entry = (capturedAtMs: number) => ({
      capturedAtMs,
      durationMs: 4000,
    });
    assert({
      given: 'segments outside, straddling, inside and straddling out',
      should: 'keep only the one wholly inside; a straddler goes whole',
      actual: wholeSegmentsInside(
        [entry(0), entry(4000), entry(8000), entry(12_000)],
        [{ fromMs: 6000, toMs: 13_000 }],
      ),
      expected: [entry(8000)],
    });
  });
});
