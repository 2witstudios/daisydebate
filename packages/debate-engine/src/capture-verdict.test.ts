import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCaptureRule, decideStreamCapture } from './capture-verdict';
import type {
  CaptureInterval,
  CoverageEdges,
  StreamCoverage,
} from '@daisy/protocol';

setupRitewayBun();
const rule = createCaptureRule({ joinMs: 0, relayMs: 0 });
const captureGaps = ({
  observed,
  ...coverage
}: StreamCoverage & { readonly observed: readonly CaptureInterval[] }) =>
  rule.gaps(coverage, observed);
const hasCompleteCaptureCoverage = ({
  observed,
  storedChunks,
  expectedChunks,
  ...coverage
}: StreamCoverage & {
  readonly observed: readonly CaptureInterval[];
  readonly storedChunks: number;
  readonly expectedChunks: number;
}) =>
  decideStreamCapture({
    ...coverage,
    epoch: 1,
    observations: observed.map((row) => ({ ...row, epoch: 1 })) as never,
    chunks: { count: storedChunks, otherEpochChunks: 0 },
    storedChunks,
    expectedChunks,
  }).state === 'complete';
const range = (start: number, end: number | null): CaptureInterval => ({
  start,
  end,
});
const exact: CoverageEdges = { openMs: 0, closeMs: 0 };
const closed = {
  authority: [range(1000, 2000), range(3000, 4000)],
  observed: [range(500, 1500), range(1500, 2500), range(2900, 4100)],
  tolerance: exact,
  storedChunks: 2,
  expectedChunks: 2,
};
/** Whether `authority` seals complete for `observed` under `tolerance`. */
const complete = (
  authority: readonly CaptureInterval[],
  observed: readonly CaptureInterval[],
  tolerance: CoverageEdges,
) =>
  hasCompleteCaptureCoverage({
    authority,
    observed,
    tolerance,
    storedChunks: 1,
    expectedChunks: 1,
  });

test('a seal requires every closed historical window and matching committed chunks', () => {
  assert({
    given:
      'adjacent observations spanning all windows with actual chunk counts',
    should: 'seal complete only when no window, coverage or chunk is missing',
    actual: [
      closed,
      { ...closed, observed: [range(500, 1499), range(1500, 4100)] },
      { ...closed, expectedChunks: 3 },
      { ...closed, authority: [range(1000, null)] },
      { ...closed, authority: [] },
      { ...closed, observed: [range(500, 2500)] },
    ].map(hasCompleteCaptureCoverage),
    expected: [true, false, false, false, false, false],
  });
});

test('overlapping unordered observations cover silence without inventing empty window authority', () => {
  assert({
    given:
      'zero-length provenance plus a real window with no recognized speech',
    should: 'allow complete silent coverage but refuse malformed evidence',
    actual: [
      {
        ...closed,
        authority: [range(1000, 1000), range(2000, 3000)],
        observed: [range(2500, 3100), range(1900, 2600)],
        storedChunks: 0,
        expectedChunks: 0,
      },
      { ...closed, authority: [range(1000, 1000)] },
      { ...closed, observed: [range(500, null)] },
      { ...closed, observed: [range(500, Number.NaN)] },
      { ...closed, storedChunks: -1, expectedChunks: -1 },
    ].map(hasCompleteCaptureCoverage),
    expected: [true, false, false, false, false],
  });
});

test('speech begins at the first captured frame inside the open zone (DEC-218)', () => {
  const sealed = (observed: readonly CaptureInterval[]) =>
    complete([range(1000, 6000)], observed, { openMs: 2000, closeMs: 0 });
  assert({
    given:
      'capture from inside the open zone with a dropout after it, from its edge, from just past it, none, and only before the window',
    should:
      'seal complete only when capture is contiguous from where speech began',
    actual: [
      sealed([range(4000, 6000), range(2500, 3900)]),
      sealed([range(3000, 6000)]),
      sealed([range(3001, 6000)]),
      sealed([]),
      sealed([range(500, 900)]),
    ],
    expected: [false, true, false, false, false],
  });
});

test('time after speech ended is forgiven only inside the close zone (DEC-220)', () => {
  const sealed = (observed: readonly CaptureInterval[]) =>
    complete([range(1000, 6000)], observed, { openMs: 0, closeMs: 500 });
  assert({
    given:
      'capture ending inside the close zone, at its edge, before it, none, past the close, and only before the window opens',
    should: 'seal complete only when capture reaches into the close zone',
    actual: [
      sealed([range(1000, 3000), range(3000, 5800)]),
      sealed([range(1000, 5500)]),
      sealed([range(1000, 5499)]),
      sealed([]),
      sealed([range(1000, 6200)]),
      complete([range(6000, 7000)], [range(5000, 6000)], {
        openMs: 0,
        closeMs: 1500,
      }),
    ],
    expected: [true, true, false, false, true, false],
  });
});

test('a window shorter than its zones still needs a captured frame inside it', () => {
  assert({
    given:
      'a short credited window whose only nearby capture belongs to the next window, and the same window with one frame inside it',
    should: 'seal partial without a frame in the window, complete with one',
    actual: [
      complete([range(1000, 1500), range(1800, 3000)], [range(1800, 3000)], {
        openMs: 1000,
        closeMs: 0,
      }),
      complete(
        [range(1000, 1500), range(1800, 3000)],
        [range(1400, 1450), range(1800, 3000)],
        { openMs: 1000, closeMs: 500 },
      ),
    ],
    expected: [false, true],
  });
});

test('a dropout before the last frame of a grant shorter than its close zone stays partial (DEC-220)', () => {
  assert({
    given:
      'a 1 s human grant captured at its start and again from 600 ms, missing 200–600 ms, and the same grant fully captured',
    should: 'seal the dropout partial and the full capture complete',
    actual: [
      complete([range(0, 1000)], [range(0, 200), range(600, 1000)], {
        openMs: 4000,
        closeMs: 1000,
      }),
      complete([range(0, 1000)], [range(0, 200), range(200, 1000)], {
        openMs: 4000,
        closeMs: 1000,
      }),
    ],
    expected: [false, true],
  });
});

test('a capture restart after speech ended inside the close zone keeps the window complete (#493)', () => {
  assert({
    given:
      'a window whose capture ends inside its close zone, then capture resumes after it',
    should: 'seal complete: the later capture never moves where speech ended',
    actual: complete(
      [range(30000, 30100)],
      [range(4900, 30050), range(31000, 60000)],
      { openMs: 0, closeMs: 1000 },
    ),
    expected: true,
  });
});

test('a human grant whose microphone dies in its last second still seals partial (ISSUE-806)', () => {
  // A human's grants carry no terminal zone.
  const human = (observed: readonly CaptureInterval[]) =>
    complete([range(0, 58500), range(59200, 60000)], observed, {
      openMs: 4000,
      closeMs: 1000,
    });
  assert({
    given:
      'a human whose capture ends before a short final grant opens, and one captured through it',
    should: 'seal the dead final grant partial, and the captured one complete',
    actual: [human([range(0, 59100)]), human([range(0, 59950)])],
    expected: [false, true],
  });
});

const tolerance = { openMs: 4000, closeMs: 1000 };
test('gaps are the required speech with no capture, by the coverage edges', () => {
  const gaps = (
    authority: { start: number; end: number | null }[],
    observed: { start: number; end: number | null }[],
  ) => captureGaps({ authority, observed, tolerance });
  assert({
    given:
      'capture either side of a hole, none at all, a late join and an open window',
    should:
      'report the hole, the whole window, nothing within tolerance and nothing for an open window',
    actual: [
      gaps(
        [{ start: 0, end: 300_000 }],
        [
          { start: 355, end: 234_145 },
          { start: 251_900, end: 300_000 },
        ],
      ),
      gaps([{ start: 0, end: 1000 }], []),
      gaps([{ start: 0, end: 10_000 }], [{ start: 3000, end: 10_000 }]),
      gaps([{ start: 0, end: null }], [{ start: 0, end: 5000 }]),
    ],
    expected: [
      [{ start: 234_145, end: 251_900 }],
      [{ start: 0, end: 1000 }],
      [],
      [],
    ],
  });
});

test('edges state what the tolerances forgave, and nothing else', () => {
  const forgiving = createCaptureRule({ joinMs: 0, relayMs: 0 });
  const coverage = {
    authority: [{ start: 0, end: 10_000 }],
    tolerance: { openMs: 4000, closeMs: 1000 },
  };
  assert({
    given:
      'a late join and early end inside tolerance, a sub-packet hole, and a hole past tolerance',
    should:
      'state the forgiven edges, drop the measure grain, and leave the real gap to gaps',
    actual: [
      forgiving.edges(coverage, [{ start: 3000, end: 9500 }]),
      forgiving.edges(coverage, [
        { start: 0, end: 5000 },
        { start: 5010, end: 10_000 },
      ]),
      forgiving.edges({ ...coverage, authority: [{ start: 0, end: 20_000 }] }, [
        { start: 0, end: 2000 },
        { start: 15_000, end: 20_000 },
      ]),
    ],
    expected: [
      [
        { start: 0, end: 3000 },
        { start: 9500, end: 10_000 },
      ],
      [],
      [],
    ],
  });
});
