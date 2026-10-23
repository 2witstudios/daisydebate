import { assert, setupRitewayBun, test } from 'riteway/bun';
import { observedWindow, straddlesGrantEdge } from './capture-history';

setupRitewayBun();

// A grant from 1000 to 9000 ms; the clip's frames run nominally 1010..8980.
const grant = { startMs: 1000, endMs: 9000 };
const clip = {
  firstNominalMs: 1010,
  lastNominalMs: 8980,
  beforeMs: 1009,
  afterMs: 8992,
};
const frame = (nominalStartMs: number, beforeMs: number, afterMs: number) => ({
  nominalStartMs,
  beforeMs,
  afterMs,
});
const startStraddle = frame(1000, 998, 1011);
const endStraddle = frame(8990, 8989, 9002);

test('contiguous frames straddling both edges extend the window to the whole grant', () => {
  assert({
    given:
      'the frame just before the first and just after the last, each straddling its grant edge',
    should: 'observe from the grant start to the grant end',
    actual: observedWindow({
      clip,
      grant,
      straddles: [startStraddle, endStraddle],
    }),
    expected: { fromMs: 1000, untilMs: 9000 },
  });
});

test('a late join or an early drop keeps the clip bracket at that edge', () => {
  assert({
    given:
      'no straddling frame at the start (late join), then none at the end (early drop)',
    should: 'extend only the edge that has contiguous evidence',
    actual: [
      observedWindow({ clip, grant, straddles: [endStraddle] }),
      observedWindow({ clip, grant, straddles: [startStraddle] }),
    ],
    expected: [
      { fromMs: 1009, untilMs: 9000 },
      { fromMs: 1000, untilMs: 8992 },
    ],
  });
});

test('a gap just inside the edge breaks the evidence', () => {
  assert({
    given:
      'straddling frames that are not contiguous with the clip (a missing 10 ms frame at each edge)',
    should: 'keep the clip bracket so the stream stays partial',
    actual: observedWindow({
      clip,
      grant,
      straddles: [frame(990, 988, 1001), frame(9000, 8999, 9012)],
    }),
    expected: { fromMs: 1009, untilMs: 8992 },
  });
});

test('a contiguous frame that does not cross the edge, or an open grant, extends nothing', () => {
  assert({
    given:
      'contiguous neighbours wholly inside the grant, and an open grant with an end-side neighbour',
    should: 'keep the clip bracket',
    actual: [
      observedWindow({
        clip,
        grant,
        straddles: [frame(1000, 1001, 1012), frame(8990, 8985, 8999)],
      }),
      observedWindow({
        clip,
        grant: { startMs: 1000, endMs: null },
        straddles: [endStraddle],
      }).untilMs,
    ],
    expected: [{ fromMs: 1009, untilMs: 8992 }, 8992],
  });
});

test('edge evidence is a frame crossing a start or end of the seat grant', () => {
  const state = {
    intervals: [
      {
        roundParticipantId: 'seat',
        startedAt: new Date(1000).toISOString(),
        endedAt: new Date(9000).toISOString(),
      },
      {
        roundParticipantId: 'other',
        startedAt: new Date(5000).toISOString(),
        endedAt: null,
      },
    ],
  } as unknown as Parameters<typeof straddlesGrantEdge>[0];
  assert({
    given:
      'frames across the start and the end, one inside, and one across another seat grant',
    should: 'count only the frames crossing this seat grant edges',
    actual: [
      straddlesGrantEdge(state, 'seat', { beforeMs: 998, afterMs: 1011 }),
      straddlesGrantEdge(state, 'seat', { beforeMs: 8989, afterMs: 9002 }),
      straddlesGrantEdge(state, 'seat', { beforeMs: 4000, afterMs: 4011 }),
      straddlesGrantEdge(state, 'seat', { beforeMs: 4995, afterMs: 5006 }),
    ],
    expected: [true, true, false, false],
  });
});
